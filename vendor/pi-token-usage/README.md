# Pure token collector snapshot

Source: Qser3ne/pi-token-usage at `295bfb579ff4d159683f6400cffdeb683c461b54` (same author/project family). Only the seven pure collector modules are copied unchanged; no extension entry, commands or report rendering is initialized. File SHA-256 values are recorded in `upstream.json`. The source repository declares no standalone license; this is a source snapshot for this author's private patch package, not a third-party relicense.

Regenerate from a checkout containing that exact commit and unchanged source files:

```sh
node scripts/vendor-token-usage.mjs /path/to/pi-token-usage
```

The default development source is `../pi-token-usage`; it is never accessed at runtime. Extraction uses `git show <pinned-commit>:src/<file>`, not the source checkout's current HEAD. Disk cache format/path stays compatible with the independent command package.
