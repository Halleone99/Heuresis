# Rebuilds gulf-stream.docx (used by tests/catalogue.mjs, "acceptance" scenario):
#   python3 make-gulf-stream.py        (requires python-docx)
# A stand-in essay of about 1,100 words with a title, subtitle, four sections and a
# quotation, in plain Word styles and without pictures: the article is illustrated
# in the Catalogue. Original text written for this test.
from docx import Document

doc = Document()
doc.add_paragraph("The Gulf Stream", style="Title")
doc.add_paragraph("A river in the ocean, and what it carries", style="Subtitle")

doc.add_paragraph(
    "Sailors knew it long before anyone could explain it. Leaving the Florida coast, a ship that "
    "pointed south could find itself carried north, against its course and against the wind, by "
    "water that was warmer, bluer and faster than the sea around it. The current had no banks and "
    "no source anyone could see, yet it behaved like a river: a band of moving water perhaps a "
    "hundred kilometres wide, running along the edge of a continent and then turning out across "
    "an ocean.")
doc.add_paragraph(
    "Today it is one of the best measured features of the planet. It is also one of the most "
    "misunderstood, credited with more than it does and watched with growing unease for what it "
    "might stop doing.")

doc.add_heading("A river in the sea", level=1)
doc.add_paragraph(
    "The stream begins where the Loop Current leaves the Gulf of Mexico and squeezes through the "
    "Straits of Florida. There, between the Keys and the Bahamas, roughly thirty million cubic "
    "metres of water pass every second, more than all the rivers of the world together. At the "
    "surface it can move at two metres a second, a speed that once added or removed days from a "
    "crossing.")
doc.add_paragraph(
    "It follows the American coast northward, hugging the edge of the continental shelf, until "
    "Cape Hatteras. There it leaves the land and heads out into the open Atlantic, meandering in "
    "great slow loops. Some of those loops pinch off as rings, warm whirlpools that drift for "
    "months in cooler water, or cold ones that wander into the warm Sargasso Sea. As it travels it "
    "gathers more water, and off Newfoundland the flow is several times what it was in Florida.")
doc.add_paragraph(
    "Why should an ocean have a river in it at all? The answer lies in the winds and in the turning "
    "of the Earth. The trade winds and the westerlies drive a vast clockwise circulation in the North "
    "Atlantic, and the rotation of the planet crowds its return flow against the western side of the "
    "basin. The same narrow, swift current appears off Japan, where it is called the Kuroshio, and "
    "off Brazil and southern Africa. Western boundaries make rivers; eastern ones make slow, broad "
    "drifts.")

doc.add_paragraph(
    "There is a river in the ocean. In the severest droughts it never fails, and in the mightiest "
    "floods it never overflows.", style="Quote")
doc.add_paragraph("— Matthew Fontaine Maury, The Physical Geography of the Sea, 1855", style="Quote")

doc.add_heading("Franklin's chart", level=1)
doc.add_paragraph(
    "In the 1760s, as deputy postmaster for the American colonies, Benjamin Franklin heard a puzzling "
    "complaint. Mail packets from Falmouth to New York took about two weeks longer than the merchant "
    "ships that sailed from London to Rhode Island, though the merchants had the longer route. His "
    "cousin Timothy Folger, a whaling captain from Nantucket, explained the difference. The whalers "
    "knew the stream, because whales kept to its edges, and they crossed it rather than sail against "
    "it. The English packet captains, he said, were too proud to take advice from American "
    "fishermen.")
doc.add_paragraph(
    "Folger sketched the current's course and Franklin had it engraved and printed. The chart was "
    "largely ignored by the British post office, but Franklin kept measuring. On his later crossings "
    "he lowered thermometers over the side, noting where the water turned warm, and suggested that "
    "captains do the same. It was one of the first times anyone had tried to map the sea by its "
    "temperature.")

doc.add_heading("Warmth for Europe", level=1)
doc.add_paragraph(
    "The stream carries an enormous quantity of heat northward, and its extension, the North Atlantic "
    "Current, brings mild water to the shores of Ireland, Scotland and Norway. Palm trees grow in "
    "Cornwall at the latitude of Newfoundland, and the Norwegian coast stays free of ice far beyond "
    "the Arctic Circle. It is tempting to give the current all the credit.")
doc.add_paragraph(
    "The truth is shared. Much of the difference between the winters of western Europe and those of "
    "eastern Canada comes from the atmosphere: from westerly winds that blow off a large, slowly "
    "cooling ocean, and from the way the Rocky Mountains bend the jet stream. The ocean's heat is "
    "part of the story, and its influence is strongest along the coasts it touches, but a Europe "
    "without the Gulf Stream would not simply freeze. The climate is a partnership of air and water, "
    "and the stream is the visible half.")

doc.add_heading("An uncertain future", level=1)
doc.add_paragraph(
    "The Gulf Stream is driven mainly by wind, and the wind will go on blowing. But the current is "
    "also part of a larger overturning circulation in the Atlantic, in which salty surface water "
    "cools in the far north, sinks and returns southward in the deep. That deeper engine is sensitive "
    "to fresh water. Melting ice from Greenland and heavier rain at high latitudes make the surface "
    "lighter and harder to sink.")
doc.add_paragraph(
    "Measurements across the Atlantic have been made continuously only since 2004, and the record is "
    "still short beside the natural swings of the ocean. Some studies find signs of weakening; others "
    "find that the evidence is not yet clear. Most climate models expect the overturning to slow "
    "during this century, while disagreeing about how much. A slower circulation would not stop the "
    "Gulf Stream, but it could shift where its warmth goes, raise sea levels along the American coast "
    "and change the storms that cross the Atlantic.")
doc.add_paragraph(
    "Folger's whalers read the stream by the colour of the water and the behaviour of whales. Today "
    "it is followed by satellites, floats and moored instruments across the ocean. The question has "
    "changed from where the river runs to how long it will run as it does now, and the answer will "
    "matter on both sides of the sea it crosses.")

doc.save("gulf-stream.docx")
