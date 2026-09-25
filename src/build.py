import re, pathlib
d = pathlib.Path(__file__).parent
strip = lambda s: re.sub(r"^if \(typeof module[^\n]*\n?", "", s, flags=re.M)
js = "\n".join(strip((d/f).read_text()) for f in ["catalog.js","engine.js","learn.js","ui.js","views.js"])
js = "(function () {\n'use strict';\n" + js + "\n})();\n"
assert "</script" not in js
html = (d/"template.html").read_text().replace("/*__CSS__*/", (d/"styles.css").read_text()).replace("/*__JS__*/", js)
(d/"dist").mkdir(exist_ok=True)
(d/"dist"/"index.html").write_text(html)
print(len(html))
