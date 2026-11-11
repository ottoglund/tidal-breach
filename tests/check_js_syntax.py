"""Extract inline JavaScript and check parsing with Node."""
from pathlib import Path
import subprocess
import tempfile

html = (Path(__file__).resolve().parents[1] / "index.html").read_text()
script = html.split("<script>", 1)[1].split("</script>", 1)[0]
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "game.js"
    path.write_text(script)
    subprocess.run(["node", "--check", str(path)], check=True)
print("JavaScript syntax: valid")
