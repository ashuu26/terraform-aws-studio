# Builds the Azure studio into one self-contained page (../dist-azure/index.html).
# Copy the result over azure/index.html at the site root.
import re, pathlib
d = pathlib.Path(__file__).parent
SOURCES = ["core.js", "gen_landingzone.js", "gen_networking.js", "gen_compute.js", "gen_storage.js",
           "gen_database.js", "gen_backup.js", "gen_monitoring.js", "engine.js", "learn.js",
           "presets.js", "ui.js", "views.js", "lz.js"]
strip = lambda s: re.sub(r"^if \(typeof module[^\n]*\n?", "", s, flags=re.M)
js = "\n".join(strip((d / f).read_text(encoding="utf-8")) for f in SOURCES)
js = "(function () {\n'use strict';\n" + js + "\n})();\n"
assert "</script" not in js
css = (d.parent / "styles.css").read_text(encoding="utf-8") + "\n" + (d / "azure.css").read_text(encoding="utf-8")
html = (d / "template.html").read_text(encoding="utf-8").replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
out = d.parent / "dist-azure"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(html, encoding="utf-8")
print(len(html))
