// Applied knowledge of other kinds than rules: definitions (transport documents), figures (CMR
// limits and deadlines) and a question. Learning material for tests, not legal advice.
import { RULE_TYPE, card } from "./applied-fixtures.mjs";

export { RULE_TYPE, card };
export const block = (dim, text, extra = {}) => JSON.stringify({ id: `${dim}-${text.slice(0, 10)}`, type: "text", dim, text, ...extra });
export const packIn = (title, collection = "logistics", type = RULE_TYPE) => ({ id: title, collection_id: collection, card_type_id: type.id, title, description: null, sort_order: 0, card_count: 0, encountered_cards: 0, open_count: 0, last_opened_at: null, cardType: type });

export const documentation = [
  card("cmr", { rule: "CMR consignment note", statement: "A consignment note commonly used for international road carriage under the CMR Convention, recording goods, parties and transport particulars.",
    _workspace_blocks: [
      block("structure", "Evidence of the contract of carriage and of receipt of the goods\nMade out in three originals, signed by the sender and the carrier\nNot a document of title: it cannot be negotiated"),
      block("neighbours", "Bill of lading — a negotiable document of title used in sea transport"),
      block("examples", "A haulier collects pallets in Lyon for a buyer in Milan; the sender and the driver sign the three originals."),
    ] }),
  card("bl", { rule: "Bill of lading", statement: "A transport document issued by the carrier for carriage by sea, acting as receipt for the goods, evidence of the contract of carriage and document of title.",
    _workspace_blocks: [
      block("structure", "Issued by the carrier or its agent once the goods are on board\nNegotiable: the holder of an original can claim the goods\nUsed in sea transport"),
      block("neighbours", "Sea waybill — not a document of title; the named consignee receives the goods without an original"),
      block("examples", "A container of machinery leaves Hamburg for Shanghai; the bank releases the original to the buyer against payment."),
    ] }),
  card("awb", { rule: "Air waybill", statement: "A non-negotiable transport document for air freight, issued by the airline or its agent, that serves as receipt for the goods and contract of carriage.",
    _workspace_blocks: [
      block("structure", "Not a document of title\nEach shipment has an 11-digit AWB number\nUsed in air transport"),
      block("examples", "Spare parts are flown from Frankfurt to Atlanta; the forwarder's agent issues the document for the airline."),
    ] }),
  card("invoice", { rule: "Commercial invoice", statement: "A document issued by the seller to the buyer, stating the goods, their price and the terms of sale; customs use it to determine the customs value.",
    _workspace_blocks: [block("structure", "Issued by the seller\nStates the price and the Incoterm\nUsed by customs to determine the customs value")] }),
  card("packing", { rule: "Packing list", statement: "A document listing the contents of each package, with weights and dimensions, used to check and handle the shipment.",
    _workspace_blocks: [
      block("structure", "Lists the contents package by package\nShows gross and net weights and dimensions\nDoes not state prices"),
      block("neighbours", "Commercial invoice — states the price of the goods; the packing list does not"),
    ] }),
  card("coo", { rule: "Certificate of origin", statement: "A document certifying the country in which the goods were obtained or produced, issued by a chamber of commerce for non-preferential origin.",
    _workspace_blocks: [
      block("structure", "Issued by a chamber of commerce\nProves non-preferential origin\nDoes not give access to preferential duty rates"),
      block("neighbours", "EUR.1 movement certificate — proof of preferential origin under an EU trade agreement"),
    ] }),
  card("eur1", { rule: "EUR.1 movement certificate", statement: "A proof of preferential origin that lets goods benefit from reduced or zero duty under an EU trade agreement.",
    _workspace_blocks: [block("structure", "Endorsed by the customs authority of the exporting country\nGives access to preferential duty rates\nUsed under EU trade agreements")] }),
];

export const figures = [
  card("limit", { rule: "CMR liability limit", statement: "8.33 SDR per kilogram of gross weight short",
    conditions: "Loss of or damage to the goods\nNo higher value or special interest in delivery has been declared", source: "CMR Convention, Art. 23" }),
  card("hidden", { rule: "Notice of non-apparent loss or damage (CMR)", statement: "Within 7 days of delivery, Sundays and public holidays excepted", source: "CMR Convention, Art. 30" }),
  card("delay", { rule: "Notice of delay (CMR)", statement: "Within 21 days from the time the goods were placed at the consignee's disposal", source: "CMR Convention, Art. 30" }),
  card("period", { rule: "CMR limitation period", statement: "1 year, or 3 years in the case of wilful misconduct", source: "CMR Convention, Art. 32" }),
];

export const questions = [
  card("q-cmr", { rule: "How many originals of a CMR note are made out?", statement: "Three: one for the sender, one travelling with the goods, one kept by the carrier.", _applied_kind: "question" }),
];
