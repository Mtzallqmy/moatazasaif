# Chat attachment security

The chat accepts a deliberately limited set of image, text, data, markup, query, and source-code formats.

## Supported formats

- Images: PNG, JPEG, WebP
- Text: TXT, Markdown
- Data and markup: JSON, CSV, TSV, XML, YAML
- Queries and source: SQL, JavaScript, TypeScript, Python, HTML, CSS, shell scripts

## Enforced controls

- At most three attachments per request.
- Aggregate attachment payload is limited to 3 MiB.
- Image MIME values must match both the data URL and the file magic bytes.
- Text sizes are recomputed on the server and compared with the declared size.
- NUL bytes and abnormal control-character density are rejected to block binary files disguised as text.
- JSON is parsed before it is sent to a provider.
- Attachments are accepted only on the final user message in a request.
- Executables, archives, office files, PDFs, and arbitrary binary formats remain blocked until dedicated safe extractors are implemented.

The browser allowlist is only a usability layer. The server performs the authoritative validation.
