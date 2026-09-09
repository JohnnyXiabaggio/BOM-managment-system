// Seed data for the `items` table — the VP2 (D-Segment BEV) as-designed
// product structure. This is the source of truth for the demo dataset;
// the frontend now loads it from the API instead of a bundled module.
export const KEYS = [
  'id', 'parent', 'find', 'pn', 'rev', 'name', 'kind', 'qty', 'uom', 'mb',
  'mass', 'cost', 'state', 'eff', 'owner', 'cls', 'plant', 'supplier',
]

export const ROWS = [
  ["root", null, "", "VP2-00000", "/C", "Vehicle Assembly", "asm", 1, "EA", "Make", 1842.0, 0, "rel", "2026-09-01", "M. Reyes", "VEH / Platform", "Plant 2 · Line B", "—"],
  ["biw", "root", "100", "BIW-10000", "/D", "Body-in-White", "asm", 1, "EA", "Make", 412.6, 0, "rel", "2026-09-01", "K. Lang", "BODY / BIW", "Plant 1 · Body Shop", "—"],
  ["biw-fe", "biw", "110", "FE-11000", "/B", "Front End Module", "part", 1, "EA", "Make", 38.4, 214.0, "rel", "2026-09-01", "K. Lang", "BODY / Front", "Plant 1 · Body Shop", "—"],
  ["biw-sl", "biw", "120", "SF-12000", "/A", "Side Frame LH", "part", 1, "EA", "Make", 21.7, 168.5, "wip", "—", "K. Lang", "BODY / Side", "Plant 1 · Body Shop", "—"],
  ["hvb", "root", "200", "HVB-20000", "/B", "HV Battery Pack", "asm", 1, "EA", "Make", 318.4, 0, "rel", "2026-09-01", "K. Ito", "PWT / ESS / Pack", "Plant 2 · Line B", "3 approved"],
  ["cma", "hvb", "10", "CMA-21000", "/A", "Cell Module Assembly", "asm", 8, "EA", "Make", 28.4, 1284.0, "rel", "2026-09-01", "K. Ito", "PWT / ESS / Module", "Plant 2 · Line B", "—"],
  ["cel", "cma", "10.1", "CEL-21100", "/C", "Prismatic Cell, 106 Ah", "part", 12, "EA", "Buy", 1.62, 64.2, "rel", "2026-09-01", "K. Ito", "PWT / ESS / Cell", "Supplier DC", "Nihon Cell Co."],
  ["bus", "cma", "10.2", "BUS-21200", "/A", "Busbar Set, Module", "part", 2, "EA", "Make", 0.84, 18.9, "wip", "—", "L. Novak", "PWT / ESS / Busbar", "Plant 2 · Line B", "—"],
  ["bms", "hvb", "20", "BMS-22000", "/C", "Battery Management ECU", "part", 1, "EA", "Buy", 0.62, 212.5, "rel", "2026-09-01", "S. Patel", "EE / Controller", "Supplier DC", "Halden Electronics"],
  ["cpl", "hvb", "30", "CPL-23000", "/A", "Coolant Plate, Pack", "part", 4, "EA", "Make", 2.15, 46.8, "rev", "—", "A. Dubois", "THM / Cold Plate", "Plant 2 · Line A", "—"],
  ["hvj", "hvb", "40", "HVJ-24000", "/B", "HV Junction Box", "part", 1, "EA", "Buy", 1.95, 168.0, "rel", "2026-09-01", "S. Patel", "EE / HV Distribution", "Supplier DC", "Kernwerk GmbH"],
  ["enc", "hvb", "70", "ENC-27000", "/D", "Lower Enclosure, Welded", "asm", 1, "EA", "Make", 41.6, 392.0, "rel", "2026-09-01", "M. Reyes", "PWT / ESS / Enclosure", "Plant 2 · Line A", "—"],
  ["pnl", "enc", "70.1", "PNL-27100", "/B", "Enclosure Panel, Stamped", "part", 4, "EA", "Make", 6.8, 42.0, "rel", "2026-09-01", "M. Reyes", "PWT / ESS / Panel", "Plant 1 · Press", "—"],
  ["lid", "hvb", "80", "LID-28000", "/B", "Pack Lid, Composite", "part", 1, "EA", "Make", 12.3, 146.0, "rel", "2026-09-01", "M. Reyes", "PWT / ESS / Lid", "Plant 2 · Line A", "—"],
  ["fst", "hvb", "90", "FST-29000", "/A", "Fastener Kit, Pack", "part", 1, "KIT", "Buy", 0.9, 22.1, "rel", "2026-09-01", "J. Weber", "COM / Fasteners", "Supplier DC", "Boltwerk AB"],
  ["thp", "hvb", "100", "THP-29500", "/A", "Thermal Pad Set", "part", 8, "EA", "Buy", 0.32, 7.6, "obs", "—", "A. Dubois", "THM / Interface", "Supplier DC", "Kernwerk GmbH"],
  ["chs", "root", "300", "CHS-30000", "/A", "Front Suspension", "asm", 1, "EA", "Make", 96.2, 0, "rel", "2026-09-01", "A. Dubois", "CHS / Front", "Plant 2 · Line C", "—"],
  ["spr", "chs", "310", "SPR-31000", "/A", "Spring & Damper Unit", "part", 2, "EA", "Buy", 8.4, 96.0, "rel", "2026-09-01", "A. Dubois", "CHS / Damping", "Supplier DC", "Federn AG"],
  ["int", "root", "400", "INT-40000", "/F", "Interior Assembly", "asm", 1, "EA", "Make", 214.8, 0, "rel", "2026-09-01", "T. Brandt", "INT / Cabin", "Plant 4 · Line A", "—"],
  ["ipn", "int", "410", "IPN-41000", "/C", "Instrument Panel Assy", "part", 1, "EA", "Buy", 18.6, 612.0, "rel", "2026-09-01", "T. Brandt", "INT / IP", "Supplier DC", "Formteil SE"],
  ["eea", "root", "500", "EEA-50000", "/G", "E/E Architecture", "asm", 1, "EA", "Buy", 62.4, 0, "rel", "2026-09-01", "S. Patel", "EE / Architecture", "Plant 2 · Line B", "—"],
  ["ccu", "eea", "510", "CCU-51000", "/B", "Central Compute Unit", "part", 1, "EA", "Buy", 2.4, 1180.0, "rel", "2026-09-01", "S. Patel", "EE / Compute", "Supplier DC", "Halden Electronics"],
  ["zon", "eea", "520", "ZON-52000", "/A", "Zonal Controller FL", "part", 4, "EA", "Buy", 0.9, 264.0, "rel", "2026-09-01", "S. Patel", "EE / Zonal", "Supplier DC", "Halden Electronics"],
  ["thm", "root", "600", "THM-60000", "/B", "Thermal System", "asm", 1, "EA", "Make", 48.9, 0, "wip", "—", "A. Dubois", "THM / Loop", "Plant 2 · Line C", "—"],
  ["hpu", "thm", "610", "HPU-61000", "/A", "Heat Pump Unit", "part", 1, "EA", "Buy", 14.2, 748.0, "rel", "2026-09-01", "A. Dubois", "THM / Heat Pump", "Supplier DC", "Kernwerk GmbH"],
  ["vin", "root", "900", "VIN-90000", "/A", "Vehicle Identity Label", "part", 1, "EA", "Buy", 0.02, 3.1, "rel", "2026-09-01", "J. Weber", "COM / Marking", "Plant 2 · Line D", "Boltwerk AB"],
]
