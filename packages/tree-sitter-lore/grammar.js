/**
 * @file tree-sitter grammar for Lore files
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// The line rules (column 0, prose up to the entry's closing tag, fences)
// live in src/scanner.c. Highlighting only: this grammar never decides
// whether a file is valid.
module.exports = grammar({
  name: "lore",

  externals: ($) => [
    $._defaults_start,
    $._scope_start,
    $._rule_start,
    $._context_start,
    $._element_start,
    $._child_start,
    $._child_end,
    $._element_end,
    $.yaml_body,
    $.check_body,
    $.text,
    $.prose,
    $.comment,
    $.top_level_text,
    $._stray_end,
    $._error_sentinel,
  ],

  extras: () => [/[ \t\r\n]/],

  rules: {
    source_file: ($) => repeat($._top_level),

    _top_level: ($) =>
      choice($.comment, $.defaults_block, $.scope_block, $.rule, $.context, $.element, $.top_level_text),

    defaults_block: ($) => seq($._defaults_start, $.start_tag, optional($.yaml_body), optional($._end)),

    scope_block: ($) => seq($._scope_start, $.start_tag, optional($.yaml_body), optional($._end)),

    element: ($) => seq($._element_start, $.start_tag, optional($.text), optional($._end)),

    rule: ($) => seq($._rule_start, $._entry_contents),

    context: ($) => seq($._context_start, $._entry_contents),

    _entry_contents: ($) => seq($.start_tag, repeat($.child), optional($.prose), optional($._end)),

    child: ($) =>
      choice(
        seq(
          $._child_start,
          $.start_tag,
          optional(choice($.yaml_body, $.check_body, $.text)),
          optional(seq($._child_end, $.end_tag)),
        ),
        seq($._stray_end, $.end_tag),
      ),

    _end: ($) => seq($._element_end, $.end_tag),

    start_tag: ($) => seq("<", alias($._name, $.tag_name), repeat($.attribute), ">"),

    end_tag: ($) => seq("</", alias($._name, $.tag_name), ">"),

    attribute: ($) => seq(alias($._name, $.attribute_name), optional(seq("=", $.attribute_value))),

    attribute_value: () => token(choice(/"[^"\r\n]*"/, /[^\s"=>]+/)),

    _name: () => /[A-Za-z][A-Za-z0-9-]*/,
  },
});
