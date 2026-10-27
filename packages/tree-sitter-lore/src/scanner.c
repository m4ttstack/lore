#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdint.h>
#include <string.h>

enum TokenType {
  DEFAULTS_START,
  SCOPE_START,
  RULE_START,
  CONTEXT_START,
  ELEMENT_START,
  CHILD_START,
  CHILD_END,
  ELEMENT_END,
  YAML_BODY,
  CHECK_BODY,
  TEXT,
  PROSE,
  COMMENT,
  TOP_LEVEL_TEXT,
  STRAY_END,
  ERROR_SENTINEL,
};

// Longer names are kept as overflowing and never match a closing tag.
#define NAME_CAP 100

typedef enum { MODE_TOP, MODE_BLOCK_YAML, MODE_BLOCK_TEXT, MODE_ENTRY } Mode;

typedef struct {
  char text[NAME_CAP];
  uint8_t len;
  bool overflow;
} Name;

typedef struct {
  Mode mode;
  Name entry;
  bool child_open;
  Name child;
} Scanner;

typedef struct {
  uint32_t indent;
  bool blank;
  bool comment;
  bool looks_like_tag;
  bool closing;
  bool exact_close;
  Name name;
  int32_t fence_char;
  uint32_t fence_len;
  bool fence_opener;
  bool fence_only;
} Line;

static inline bool is_space(int32_t c) { return c == ' ' || c == '\t' || c == '\r'; }

static inline bool is_letter(int32_t c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

static inline bool is_name_char(int32_t c) { return is_letter(c) || (c >= '0' && c <= '9') || c == '-'; }

static inline bool at_line_end(TSLexer *lexer) { return lexer->eof(lexer) || lexer->lookahead == '\n'; }

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static void name_set(Name *name, const char *text, uint8_t len, bool overflow) {
  memcpy(name->text, text, len);
  name->len = len;
  name->overflow = overflow;
}

static bool name_equals(const Name *a, const Name *b) {
  return !a->overflow && !b->overflow && a->len == b->len && memcmp(a->text, b->text, a->len) == 0;
}

static bool name_is(const Name *name, const char *text) {
  size_t len = strlen(text);
  return !name->overflow && name->len == len && memcmp(name->text, text, len) == 0;
}

static void skip_rest_of_line(TSLexer *lexer) {
  while (!at_line_end(lexer)) advance(lexer);
}

// Reads one line from its first character up to, not including, its line
// feed, and records what the line rules need to know about it.
static void read_line(TSLexer *lexer, Line *line, bool allow_comment) {
  memset(line, 0, sizeof(*line));

  while (is_space(lexer->lookahead) || lexer->lookahead == 0xFEFF) {
    if (lexer->lookahead == ' ' || lexer->lookahead == '\t') line->indent++;
    advance(lexer);
  }
  if (at_line_end(lexer)) {
    line->blank = true;
    return;
  }

  int32_t first = lexer->lookahead;
  if (first == '`' || first == '~') {
    while (lexer->lookahead == first) {
      line->fence_len++;
      advance(lexer);
    }
    bool backtick_after = false;
    bool only_space = true;
    while (!at_line_end(lexer)) {
      if (lexer->lookahead == '`') backtick_after = true;
      if (!is_space(lexer->lookahead)) only_space = false;
      advance(lexer);
    }
    line->fence_char = first;
    line->fence_opener = line->fence_len >= 3 && (first == '~' || !backtick_after);
    line->fence_only = only_space;
    return;
  }

  if (first != '<') {
    skip_rest_of_line(lexer);
    return;
  }
  advance(lexer);

  if (lexer->lookahead == '!') {
    advance(lexer);
    if (allow_comment && line->indent == 0 && lexer->lookahead == '-') {
      advance(lexer);
      if (lexer->lookahead == '-') {
        advance(lexer);
        line->comment = true;
        return;
      }
    }
    skip_rest_of_line(lexer);
    return;
  }

  if (lexer->lookahead == '/') {
    line->closing = true;
    advance(lexer);
  }
  if (!is_letter(lexer->lookahead)) {
    skip_rest_of_line(lexer);
    return;
  }

  char text[NAME_CAP];
  uint32_t len = 0;
  while (is_name_char(lexer->lookahead)) {
    if (len < NAME_CAP) text[len] = (char)lexer->lookahead;
    len++;
    advance(lexer);
  }
  name_set(&line->name, text, len < NAME_CAP ? (uint8_t)len : NAME_CAP, len > NAME_CAP);

  int32_t after_name = lexer->lookahead;
  uint32_t visible_after_name = 0;
  int32_t last_visible = 0;
  while (!at_line_end(lexer)) {
    if (!is_space(lexer->lookahead)) {
      visible_after_name++;
      last_visible = lexer->lookahead;
    }
    advance(lexer);
  }

  bool lone_close = after_name == '>' && visible_after_name == 1;
  line->looks_like_tag = lone_close || ((after_name == ' ' || after_name == '\t') && last_visible == '>');
  line->exact_close = line->closing && lone_close;
}

static void scan_comment(TSLexer *lexer) {
  uint32_t dashes = 0;
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    advance(lexer);
    if (c == '>' && dashes >= 2) break;
    dashes = c == '-' ? dashes + 1 : 0;
  }
  lexer->mark_end(lexer);
}

static bool closes_element(const Scanner *s, const Line *line) {
  return !line->blank && line->indent == 0 && line->exact_close && name_equals(&line->name, &s->entry);
}

static bool closes_child(const Scanner *s, const Line *line) {
  return !line->blank && line->exact_close && name_equals(&line->name, &s->child);
}

// A body runs from its first line to the line before the one that ends it,
// without trailing blank lines. The first line is already read.
static void scan_body(Scanner *s, TSLexer *lexer, Line *line) {
  for (;;) {
    if (!line->blank) lexer->mark_end(lexer);
    if (lexer->eof(lexer)) return;
    advance(lexer);
    read_line(lexer, line, false);
    if (closes_element(s, line)) return;
    if (s->child_open && closes_child(s, line)) return;
  }
}

static void scan_prose(Scanner *s, TSLexer *lexer, Line *line) {
  bool in_fence = false;
  int32_t fence_char = 0;
  uint32_t fence_len = 0;
  for (;;) {
    if (!line->blank) {
      if (in_fence) {
        if (line->fence_char == fence_char && line->fence_only && line->fence_len >= fence_len) in_fence = false;
      } else if (line->fence_opener) {
        in_fence = true;
        fence_char = line->fence_char;
        fence_len = line->fence_len;
      }
      lexer->mark_end(lexer);
    }
    if (lexer->eof(lexer)) return;
    advance(lexer);
    read_line(lexer, line, false);
    if (!in_fence && closes_element(s, line)) return;
  }
}

static void open_element(Scanner *s, const Line *line, Mode mode) {
  s->mode = mode;
  s->entry = line->name;
  s->child_open = false;
}

static void close_element(Scanner *s) {
  s->mode = MODE_TOP;
  s->entry.len = 0;
  s->child_open = false;
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool scan_top(Scanner *s, TSLexer *lexer, const bool *valid, Line *line) {
  if (line->comment) {
    if (!valid[COMMENT]) return false;
    scan_comment(lexer);
    return emit(lexer, valid, COMMENT);
  }
  if (line->indent != 0 || !line->looks_like_tag || line->closing) {
    lexer->mark_end(lexer);
    return emit(lexer, valid, TOP_LEVEL_TEXT);
  }

  enum TokenType token = ELEMENT_START;
  Mode mode = MODE_BLOCK_TEXT;
  if (name_is(&line->name, "defaults")) {
    token = DEFAULTS_START;
    mode = MODE_BLOCK_YAML;
  } else if (name_is(&line->name, "scope")) {
    token = SCOPE_START;
    mode = MODE_BLOCK_YAML;
  } else if (name_is(&line->name, "rule")) {
    token = RULE_START;
    mode = MODE_ENTRY;
  } else if (name_is(&line->name, "context")) {
    token = CONTEXT_START;
    mode = MODE_ENTRY;
  }
  if (!emit(lexer, valid, token)) return false;
  open_element(s, line, mode);
  return true;
}

static enum TokenType child_body(const Name *child) {
  if (name_is(child, "when") || name_is(child, "scope") || name_is(child, "meta")) return YAML_BODY;
  if (name_is(child, "check")) return CHECK_BODY;
  return TEXT;
}

static bool scan_entry(Scanner *s, TSLexer *lexer, const bool *valid, Line *line) {
  if (s->child_open) {
    if (closes_child(s, line) && !closes_element(s, line)) {
      if (!emit(lexer, valid, CHILD_END)) return false;
      s->child_open = false;
      return true;
    }
    if (closes_element(s, line)) {
      if (!emit(lexer, valid, ELEMENT_END)) return false;
      close_element(s);
      return true;
    }
    enum TokenType body = child_body(&s->child);
    if (!valid[body]) return false;
    scan_body(s, lexer, line);
    return emit(lexer, valid, body);
  }

  if (closes_element(s, line)) {
    if (!emit(lexer, valid, ELEMENT_END)) return false;
    close_element(s);
    return true;
  }
  if (line->looks_like_tag) {
    if (line->closing) return emit(lexer, valid, STRAY_END);
    if (!emit(lexer, valid, CHILD_START)) return false;
    s->child_open = true;
    s->child = line->name;
    return true;
  }
  if (!valid[PROSE]) return false;
  scan_prose(s, lexer, line);
  return emit(lexer, valid, PROSE);
}

static bool scan_block(Scanner *s, TSLexer *lexer, const bool *valid, Line *line) {
  if (closes_element(s, line)) {
    if (!emit(lexer, valid, ELEMENT_END)) return false;
    close_element(s);
    return true;
  }
  enum TokenType body = s->mode == MODE_BLOCK_YAML ? YAML_BODY : TEXT;
  if (!valid[body]) return false;
  scan_body(s, lexer, line);
  return emit(lexer, valid, body);
}

void *tree_sitter_lore_external_scanner_create(void) { return ts_calloc(1, sizeof(Scanner)); }

void tree_sitter_lore_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_lore_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *s = (Scanner *)payload;
  unsigned size = 0;
  buffer[size++] = (char)s->mode;
  buffer[size++] = (char)s->child_open;
  buffer[size++] = (char)s->entry.overflow;
  buffer[size++] = (char)s->entry.len;
  memcpy(buffer + size, s->entry.text, s->entry.len);
  size += s->entry.len;
  buffer[size++] = (char)s->child.overflow;
  buffer[size++] = (char)s->child.len;
  memcpy(buffer + size, s->child.text, s->child.len);
  size += s->child.len;
  return size;
}

void tree_sitter_lore_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = (Scanner *)payload;
  memset(s, 0, sizeof(*s));
  if (length == 0) return;
  unsigned i = 0;
  s->mode = (Mode)buffer[i++];
  s->child_open = buffer[i++];
  s->entry.overflow = buffer[i++];
  s->entry.len = (uint8_t)buffer[i++];
  memcpy(s->entry.text, buffer + i, s->entry.len);
  i += s->entry.len;
  s->child.overflow = buffer[i++];
  s->child.len = (uint8_t)buffer[i++];
  memcpy(s->child.text, buffer + i, s->child.len);
}

bool tree_sitter_lore_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid) {
  Scanner *s = (Scanner *)payload;
  if (valid[ERROR_SENTINEL]) return false;

  if (lexer->get_column(lexer) != 0) {
    while (is_space(lexer->lookahead)) lexer->advance(lexer, true);
    if (lexer->eof(lexer)) return false;
    if (lexer->lookahead != '\n') {
      if (s->mode != MODE_TOP) return false;
      skip_rest_of_line(lexer);
      lexer->mark_end(lexer);
      return emit(lexer, valid, TOP_LEVEL_TEXT);
    }
    lexer->advance(lexer, true);
  }

  Line line;
  for (;;) {
    lexer->mark_end(lexer);
    if (lexer->eof(lexer)) return false;
    read_line(lexer, &line, s->mode == MODE_TOP);
    if (!line.blank) break;
    if (lexer->eof(lexer)) return false;
    lexer->advance(lexer, true);
  }

  switch (s->mode) {
    case MODE_TOP:
      return scan_top(s, lexer, valid, &line);
    case MODE_ENTRY:
      return scan_entry(s, lexer, valid, &line);
    default:
      return scan_block(s, lexer, valid, &line);
  }
}
