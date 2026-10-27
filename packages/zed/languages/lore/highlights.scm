(comment) @comment

(tag_name) @tag

(attribute_name) @attribute

(attribute_value) @string

(check_body) @string.regex

; Zed gives a node the last pattern that captures it, so this `lang`
; override comes after the default above.
(child
  (start_tag
    (attribute
      (attribute_name) @_lang
      (attribute_value) @_value))
  (check_body) @string
  (#eq? @_lang "lang")
  (#not-eq? @_value "\"regex\""))

[
  "<"
  "</"
  ">"
] @punctuation.bracket

"=" @punctuation.delimiter
