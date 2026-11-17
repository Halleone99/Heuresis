// Realistic Applied cards, shared by the checks and the measurements: Incoterms, EU export control,
// procedures, a rule alone in its topic, IFRS 15 revenue rules and an example company policy.
// They are learning material for tests, not legal or accounting advice.

// The built-in Rule card type, as the migration 20261117160000 creates it.
export const RULE_TYPE = {
  id: "00000000-0000-4000-8000-000000000006", name: "Rule — Applied", teaching_shape: "rule", field_schema: [
    { key: "rule", label: "Rule or procedure", role: "term", required: true },
    { key: "statement", label: "What it requires", role: "meaning", required: true },
    { key: "conditions", label: "Applies when", role: "condition" },
    { key: "exceptions", label: "Unless", role: "exception" },
    { key: "steps", label: "Steps", role: "step" },
    { key: "case", label: "Case", role: "case" },
    { key: "outcome", label: "Outcome", role: "outcome" },
    { key: "source", label: "Source", role: "source" },
    { key: "note", label: "Note", role: "extra" },
  ],
};
export const pack = (title, type = RULE_TYPE) => ({ id: title, collection_id: "c", card_type_id: type.id, title, description: null, sort_order: 0, card_count: 0, encountered_cards: 0, open_count: 0, last_opened_at: null, cardType: type });
export const extraCase = (situation, outcome, extra = {}) => JSON.stringify({ id: situation.slice(0, 8), type: "text", dim: "examples", text: `${situation}\n→ ${outcome}`, ...extra });
export const card = (id, data) => ({ id, pack_id: "p", retention: "learning", data, note: null, favourite: false, interesting: false, interest_rank: null, created_at: "", updated_at: "", tags: [], stats: {} });

export const topics = {
  "Incoterms 2020": [
    card("exw", { rule: "EXW — Ex Works", statement: "The seller delivers by placing the goods at the buyer's disposal at its own premises, not loaded and not cleared for export.",
      conditions: "Any mode of transport", case: "A Spanish buyer collects machine parts at the seller's warehouse in Stuttgart. The goods still need export clearance.",
      outcome: "The buyer arranges export clearance.",
      _workspace_blocks: [extraCase("Under EXW, the goods are damaged while the seller's forklift loads them onto the buyer's truck.", "The buyer bears the loss: loading is at the buyer's risk.")] }),
    card("fca", { rule: "FCA — Free Carrier", statement: "The seller delivers the goods, cleared for export, to the carrier nominated by the buyer at the named place; risk passes on delivery.",
      conditions: "Any mode of transport\nThe buyer nominates the carrier", case: "FCA seller's premises in Lyon: the buyer's truck arrives to collect the goods.",
      outcome: "The seller loads the goods onto the buyer's truck.",
      _workspace_blocks: [extraCase("FCA Hamburg container terminal: the goods are lost on the seller's truck on the way to the terminal.", "The seller bears the loss: risk passes only on delivery at the terminal.")] }),
    card("cpt", { rule: "CPT — Carriage Paid To", statement: "The seller pays the carriage to the named destination, but risk passes when the goods are handed to the first carrier.",
      conditions: "Any mode of transport", case: "CPT Milan: the goods are damaged on the train after the seller handed them to the first carrier in Munich.",
      outcome: "The buyer bears the risk of the damage." }),
    card("cif", { rule: "CIF — Cost, Insurance and Freight", statement: "The seller pays cost, freight and minimum insurance to the port of destination; risk passes once the goods are on board at the port of shipment.",
      conditions: "Sea or inland waterway transport only", exceptions: "Containers handed over at an inland terminal (use CIP instead)",
      case: "CIF Shanghai: the container falls overboard during the voyage.", outcome: "The buyer bears the risk and claims under the seller's insurance.",
      _workspace_blocks: [extraCase("The buyer asks which insurance cover the seller must take out under CIF.", "Minimum cover (Institute Cargo Clauses C) for at least 110% of the contract price.")] }),
    card("dap", { rule: "DAP — Delivered at Place", statement: "The seller delivers when the goods are placed at the buyer's disposal on the arriving means of transport, ready for unloading at the named place.",
      conditions: "Any mode of transport", case: "DAP buyer's warehouse in Lyon: the truck arrives and the goods must be unloaded.", outcome: "The buyer unloads the goods.",
      _workspace_blocks: [extraCase("DAP Zurich: the goods must be cleared for import into Switzerland.", "The buyer clears the goods for import and pays the duties.")] }),
    card("ddp", { rule: "DDP — Delivered Duty Paid", statement: "The seller bears all costs and risks to the named destination, including import clearance, duties and taxes.",
      conditions: "Any mode of transport", case: "DDP Chicago: import duties are due when the goods enter the United States.", outcome: "The seller pays the import duties." }),
  ],
  "German export control": [
    card("art3", { rule: "Export authorisation for listed items", statement: "An authorisation is required to export dual-use items listed in Annex I out of the Union.",
      conditions: "The item is listed in Annex I\nThe item leaves the customs territory of the Union", exceptions: "A Union general export authorisation covers the export",
      case: "A Dutch firm ships an encryption router listed in Annex I to a customer in Brazil.", outcome: "An export authorisation is required.",
      source: "Regulation (EU) 2021/821, Art. 3",
      _workspace_blocks: [extraCase("The same router is shipped to a customer in Japan, within the conditions of EU001.", "No individual licence is needed: EU001 covers the export.")] }),
    card("art4", { rule: "Catch-all for non-listed items", statement: "Non-listed items need an authorisation when the authority has informed the exporter that they may be intended for a prohibited end-use.",
      conditions: "The item is not listed in Annex I; The authority has informed the exporter of a possible prohibited end-use", exceptions: "",
      case: "A non-listed machine tool; the authority informs the exporter it may be used in a missile programme.", outcome: "An authorisation is required under the catch-all.",
      source: "Regulation (EU) 2021/821, Art. 4" }),
    card("art11", { rule: "Intra-EU transfer of Annex IV items", statement: "Transfers within the Union need an authorisation only for the dual-use items listed in Annex IV.",
      conditions: "The item is listed in Annex IV\nThe item moves between two Member States", exceptions: "",
      case: "A French company sends an Annex I item that is not in Annex IV to its subsidiary in Italy.", outcome: "No authorisation is needed for the transfer.",
      _workspace_blocks: [extraCase("An Annex IV item is sent from Germany to Austria.", "An authorisation is required for the transfer.")] }),
    card("oral", { rule: "Oral export declaration", statement: "Commercial goods may be declared for export orally if their value does not exceed EUR 1,000 and their net mass does not exceed 1,000 kg.",
      conditions: "Value not above EUR 1,000\nNet mass not above 1,000 kg", exceptions: "The goods are subject to prohibitions or restrictions\nThe export is part of a regular series of similar operations",
      case: "One pallet of hand tools worth EUR 800, 300 kg net, in a one-off shipment.", outcome: "An oral declaration is possible." }),
  ],
  "Procedures": [
    card("decl", { rule: "Electronic export declaration", statement: "Goods leaving the Union are declared electronically before they are presented at the customs office of export.",
      steps: "1. Classify the goods (CN code)\n2. Check export controls and sanctions\n3. Lodge the declaration electronically\n4. Present the goods at the customs office of export\n5. Receive the release for export\n6. Have the exit confirmed at the office of exit" }),
    card("recall", { rule: "Product recall", statement: "Unsafe products are withdrawn from the market and customers are informed without delay.",
      steps: "- Stop deliveries\n- Inform the market surveillance authority\n- Inform distributors and customers\n- Take back the products\n- Record the recall" }),
    card("audit", { rule: "Internal compliance audit", statement: "The internal compliance programme is reviewed at least once every 12 months and the findings are documented.",
      conditions: "An internal compliance programme exists" }),
  ],
  "A topic with one rule": [
    card("lone", { rule: "Four-eyes principle", statement: "Every export licence application is checked and signed by a second, independent person before it is filed.",
      conditions: "The application is for an export licence" }),
  ],
  // A field unrelated to trade: accounting rules (IFRS 15) and a procedure.
  "IFRS 15 revenue": [
    card("ifrs-steps", { rule: "Five-step revenue model", statement: "Revenue from a contract with a customer is recognised by applying five steps, in order.",
      steps: "Identify the contract with the customer\nIdentify the performance obligations\nDetermine the transaction price\nAllocate the price to the performance obligations\nRecognise revenue when (or as) each obligation is satisfied",
      case: "A software firm sells a licence with two years of support for one price; both are distinct.", outcome: "Licence and support are separate performance obligations: the price is allocated between them." }),
    card("ifrs-time", { rule: "Revenue over time", statement: "Revenue is recognised over time if one of three criteria is met; otherwise at a point in time.",
      conditions: "The customer receives and consumes the benefit as the entity performs\nThe entity's work creates or enhances an asset the customer controls\nThe asset has no alternative use and there is an enforceable right to payment to date",
      case: "A cleaning company provides monthly office cleaning under a one-year contract.", outcome: "Revenue is recognised over time: the customer consumes the benefit as the cleaning is done.",
      _workspace_blocks: [extraCase("A retailer sells a television in its shop.", "Revenue is recognised at a point in time: when the customer obtains control of the television.")] }),
    card("ifrs-variable", { rule: "Variable consideration", statement: "Variable amounts are included in the transaction price only to the extent that a significant reversal of revenue is highly probable not to occur.",
      conditions: "The amount the entity is entitled to can vary (discounts, rebates, bonuses, penalties)",
      case: "A builder is promised a bonus of EUR 50,000 for finishing early; the outcome depends on the weather.", outcome: "The bonus is left out of the price for now: a significant reversal cannot be ruled out.",
      _workspace_blocks: [extraCase("A supplier grants a volume rebate that, on past experience, customers almost always reach.", "The expected rebate reduces the transaction price from the start: its outcome is highly predictable.")] }),
    card("ifrs-costs", { rule: "Costs of obtaining a contract", statement: "Incremental costs of obtaining a contract are capitalised if the entity expects to recover them.",
      conditions: "The cost would not have arisen without the contract\nThe entity expects to recover it", exceptions: "The amortisation period would be one year or less (the cost may be expensed)",
      case: "A sales commission of EUR 5,000 is paid on signing a three-year service contract.", outcome: "The commission is capitalised and amortised over the contract period." }),
  ],
  // Business rules of an example company (invented policy, used only as test material).
  "Example travel expense policy": [
    card("hotel", { rule: "Hotel cost limit", statement: "Hotel costs are reimbursed up to EUR 150 per night in Germany and EUR 200 per night abroad.",
      conditions: "The trip was approved in advance", exceptions: "Trade-fair weeks, with the manager's written approval",
      case: "An approved two-night trip to Munich; the hotel costs EUR 140 per night.", outcome: "Fully reimbursed: the cost is below the EUR 150 limit.",
      _workspace_blocks: [extraCase("An approved trip to Paris; the hotel costs EUR 240 per night, with no special approval.", "EUR 200 per night is reimbursed; the employee pays the difference."),
        extraCase("An approved trip to Hamburg during a trade-fair week; the hotel costs EUR 260 per night, approved in writing by the manager.", "Reimbursed in full: a trade-fair week with written approval is an exception to the limit.")] }),
    card("receipts", { rule: "Original receipts", statement: "Expenses are reimbursed only against an original receipt submitted within 30 days.",
      conditions: "An original receipt\nSubmitted within 30 days of the trip", exceptions: "A lost receipt up to EUR 25 may be replaced by a signed own declaration",
      case: "A taxi receipt of EUR 18 is lost.", outcome: "A signed own declaration replaces it: the amount is under EUR 25.",
      _workspace_blocks: [extraCase("Receipts for a March trip are handed in at the end of May.", "Not reimbursed: they are more than 30 days late.")] }),
    card("claim", { rule: "Expense claim procedure", statement: "Travel expenses are claimed in the expense tool and paid with the next salary.",
      steps: "Collect the original receipts\nEnter the claim in the expense tool\nAttach the receipts and the trip approval\nThe manager approves the claim\nFinance pays it with the next salary" }),
    card("meals", { rule: "Meal allowance", statement: "A daily meal allowance is paid instead of meal receipts; meals provided by the employer or a customer reduce it.",
      conditions: "The trip lasts more than 8 hours",
      case: "A day trip of 10 hours; lunch is provided by the customer.", outcome: "The allowance is paid, reduced for the lunch provided.",
      _workspace_blocks: [extraCase("A day trip of 6 hours with no meals provided.", "No allowance: the trip is not longer than 8 hours.")] }),
  ],
};

