// Common home maintenance chores, offered in the add form and as a one-tap starter list.
// Seasonal chores happen once a year in a given month (1 = January).
const every = (name, area, intervalDays, notes = "") => ({ name, area, schedule: "interval", intervalDays, notes });
const yearlyIn = (name, area, month, notes = "") => ({ name, area, schedule: "seasonal", month, intervalDays: 365, notes });

export const COMMON_TASKS = [
  every("Replace HVAC air filter", "HVAC", 91, "Write the filter size here"),
  every("Test smoke & CO detectors", "Safety", 30),
  every("Clean gutters", "Exterior", 182),
  yearlyIn("Service furnace", "HVAC", 9),
  yearlyIn("Service air conditioner", "HVAC", 4),
  every("Flush water heater", "Plumbing", 365),
  yearlyIn("Shut off outdoor faucets", "Exterior", 10, "Drain hoses before the first freeze"),
  yearlyIn("Turn outdoor faucets back on", "Exterior", 4),
  every("Clean range hood filter", "Kitchen", 91),
  every("Clean dishwasher filter", "Kitchen", 30),
  every("Clean refrigerator coils", "Appliances", 182),
  every("Clean dryer vent", "Appliances", 365),
  every("Check fire extinguisher", "Safety", 365, "Gauge needle should be in the green"),
  yearlyIn("Replace smoke detector batteries", "Safety", 11, "An easy one to tie to the clock change"),
  every("Clean garbage disposal", "Kitchen", 30),
  every("Replace fridge water filter", "Kitchen", 182),
  yearlyIn("Inspect roof", "Exterior", 4),
  every("Reseal grout", "Interior", 365),
  yearlyIn("Aerate lawn", "Yard", 9),
];

/** Suggestions for the Home info page. */
export const HOME_INFO_IDEAS = [
  ["HVAC filter size", "e.g. 16×25×1, MERV 8"],
  ["Furnace", "Brand, model, serial number, install date"],
  ["Water heater", "Brand, model, capacity, install date"],
  ["Main water shut-off", "Where it is and how to close it"],
  ["Electrical panel", "Location and what each breaker controls"],
  ["Paint colors", "Room, brand, color name and finish"],
  ["Plumber", "Name and phone number"],
  ["Electrician", "Name and phone number"],
];
