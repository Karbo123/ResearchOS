import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class LatexCompileTests(unittest.TestCase):
    def test_fixed_latexmk_command_produces_a_nonempty_pdf(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            paper = root / "main.tex"
            paper.write_text(
                "\\documentclass{article}\n"
                "\\title{Research OS compile check}\n"
                "\\begin{document}\\maketitle\n"
                "This is a deterministic toolchain check.\n"
                "\\end{document}\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    "latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error",
                    f"-outdir={root}", "main.tex",
                ],
                cwd=root,
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stdout[-4000:])
            pdf = root / "main.pdf"
            self.assertTrue(pdf.is_file())
            self.assertGreater(pdf.stat().st_size, 100)
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF"))
