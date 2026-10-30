# Rebuilds catalogue-sample.docx (used by tests/catalogue.mjs): python3 make-catalogue-sample.py
# Requires python-docx and Pillow. The document deliberately mixes supported structure
# (title, subtitle, headings, bold, italic, lists, quotation, picture, caption, table)
# with something the Catalogue does not keep (underline), and four languages.
from docx import Document
from docx.shared import Inches
from PIL import Image, ImageDraw
import io

img = Image.new("RGB", (1200, 800), (196, 170, 132))
d = ImageDraw.Draw(img)
for i in range(0, 800, 40):
    d.rectangle([0, i, 1200, i + 20], fill=(150 + i // 10 % 60, 120, 90))
d.ellipse([420, 220, 780, 580], fill=(60, 44, 36))
buf = io.BytesIO(); img.save(buf, "PNG"); buf.seek(0)

doc = Document()
doc.add_paragraph("The Battle of the Teutoburg Forest", style="Title")
doc.add_paragraph("Rome’s frontier on the Rhine, AD 9", style="Subtitle")
doc.add_heading("Prelude", level=1)
p = doc.add_paragraph("In the autumn of AD 9, three Roman legions under ")
p.add_run("Publius Quinctilius Varus").bold = True
p.add_run(" marched into the forests of ")
p.add_run("Germania").italic = True
p.add_run(". Arminius, a ")
u = p.add_run("trusted")
u.underline = True
p.add_run(" officer of Germanic birth, had prepared an ambush.")
doc.add_heading("The march", level=2)
doc.add_paragraph("Muddy tracks between hills and marsh", style="List Bullet")
doc.add_paragraph("A column several kilometres long", style="List Bullet")
doc.add_paragraph("Night attacks on the camp", style="List Number")
doc.add_paragraph("A final stand at Kalkriese", style="List Number")
doc.add_paragraph("Quintili Vare, legiones redde!", style="Quote")
doc.add_paragraph("— Augustus, according to Suetonius", style="Quote")
doc.add_picture(buf, width=Inches(4))
doc.add_paragraph("The Kalkriese site today (illustration).", style="Caption")
doc.add_heading("Consequences", level=1)
doc.add_paragraph("Rome never again tried to conquer Germania east of the Rhine. Die Varusschlacht gilt als Wendepunkt. Битва в Тевтобургском лесу. 条顿堡森林战役。")
t = doc.add_table(rows=3, cols=2)
t.rows[0].cells[0].text = "Year"; t.rows[0].cells[1].text = "Event"
t.rows[1].cells[0].text = "AD 9"; t.rows[1].cells[1].text = "Battle"
t.rows[2].cells[0].text = "AD 16"; t.rows[2].cells[1].text = "Germanicus returns"
doc.save("catalogue-sample.docx")
