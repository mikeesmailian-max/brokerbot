import { randomUUID } from "crypto";
import type { Carrier, Customer, Load, TableMap, TableName } from "./types";

/**
 * Demo data so the command center is alive the first time you open it.
 * Every company and phone number here is fictional.
 */
export function seedDemo(mem: { [K in TableName]: TableMap[K][] }) {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  const carrierRows: [string, string, string, string, string[], string, string, string, number][] = [
    ["Lone Mesa Transport", "MC481920", "Ray Dalton", "0101", ["Dry Van"], "Dallas", "TX", "TX to GA, TX to TN", 14],
    ["Blue Heron Freightways", "MC773310", "Carla Voss", "0102", ["Dry Van", "Reefer"], "Fort Worth", "TX", "TX to Southeast", 9],
    ["Ironwood Hauling", "MC629004", "Dee Marsh", "0103", ["Flatbed"], "Houston", "TX", "TX, LA, OK", 6],
    ["Three Rivers Logistics", "MC550812", "Sam Okafor", "0104", ["Dry Van"], "Atlanta", "GA", "GA to TX backhaul", 11],
    ["Prairie Wind Carriers", "MC918277", "Hank Lowell", "0105", ["Dry Van"], "Oklahoma City", "OK", "OK, TX, AR", 4],
    ["Copperline Express", "MC334190", "Mina Castillo", "0106", ["Reefer"], "Laredo", "TX", "TX to Midwest", 7],
    ["Tall Pine Trucking", "MC208845", "Gus Whitaker", "0107", ["Dry Van"], "Shreveport", "LA", "LA, TX, MS", 3],
    ["Redstone Carriers", "MC661527", "Jo Brennan", "0108", ["Dry Van", "Flatbed"], "Memphis", "TN", "TN to TX, TN to GA", 8],
    ["Harbor Light Transport", "MC447203", "Eli Navarro", "0109", ["Dry Van"], "Savannah", "GA", "Southeast regional", 5],
    ["Silver Fork Freight", "MC805561", "Tess Monroe", "0110", ["Reefer", "Dry Van"], "Austin", "TX", "TX triangle", 2],
    ["Big Sky Roadways", "MC592338", "Walt Ferris", "0111", ["Dry Van"], "Little Rock", "AR", "AR, TX, TN", 6],
    ["Marigold Motor Lines", "MC713046", "Nia Hartwell", "0112", ["Dry Van"], "Birmingham", "AL", "AL to TX", 10],
    ["Cedar Ridge Hauling", "MC286719", "Bo Kessler", "0113", ["Flatbed", "Step Deck"], "Tulsa", "OK", "OK, KS, TX", 1],
    ["Northgate Express", "MC934402", "Liv Aldana", "0114", ["Dry Van"], "San Antonio", "TX", "TX to anywhere", 12],
    ["Quarry Hill Transport", "MC175830", "Pete Sandoval", "0115", ["Dry Van"], "Jackson", "MS", "MS, AL, GA", 3],
    ["Foxglove Freight", "MC660291", "Ana Reyes", "0116", ["Reefer"], "Nashville", "TN", "TN, GA, FL", 5],
  ];
  const carriers: Carrier[] = carrierRows.map(([name, mc, contact, tail, eq, city, st, lanes, hauled], i) => ({
    id: randomUUID(),
    name,
    mc_number: mc,
    dot_number: null,
    contact_name: contact,
    phone: "+1214555" + tail,
    email: `dispatch@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
    equipment_types: eq,
    home_city: city,
    home_state: st,
    preferred_lanes: lanes,
    notes: null,
    do_not_call: false,
    loads_hauled: hauled,
    last_contacted_at: null,
    created_at: iso(120 - i),
  }));
  mem.carriers.push(...carriers);

  const customerRows: [string, string, string, string][] = [
    ["Brightwell Packaging", "Dana Whitfield", "0141", "dana@brightwellpackaging.example"],
    ["Juniper Home Goods", "Marcus Lee", "0142", "marcus@juniperhome.example"],
    ["Stonebridge Building Supply", "Priya Raman", "0143", "priya@stonebridgesupply.example"],
    ["Golden Acre Foods", "Tom Becker", "0144", "tom@goldenacrefoods.example"],
    ["Halcyon Paper Co.", "Ruth Amara", "0145", "ruth@halcyonpaper.example"],
  ];
  const customers: Customer[] = customerRows.map(([name, contact, tail, email], i) => ({
    id: randomUUID(),
    name,
    contact_name: contact,
    phone: "+1972555" + tail,
    email,
    notes: null,
    do_not_call: false,
    last_contacted_at: null,
    created_at: iso(200 - i),
  }));
  mem.customers.push(...customers);

  const base = (p: Partial<Load>): Load => ({
    id: randomUUID(),
    ref: "L-" + Math.floor(10000 + Math.random() * 90000),
    customer_id: null,
    customer_name: null,
    origin_city: null,
    origin_state: null,
    dest_city: null,
    dest_state: null,
    pickup_date: null,
    pickup_time: null,
    delivery_date: null,
    delivery_time: null,
    equipment: "Dry Van",
    commodity: null,
    weight_lbs: null,
    miles: null,
    special_instructions: null,
    customer_rate: null,
    target_rate: null,
    max_rate: null,
    negotiation_style: "balanced",
    status: "delivered",
    source: "history",
    covered_by_carrier_id: null,
    covered_by_name: null,
    covered_rate: null,
    covered_via: null,
    covered_at: null,
    created_at: new Date().toISOString(),
    ...p,
  });

  // Shipping history: [customer index, origin, dest, equipment, commodity, rate, every N days, count, most recent days ago]
  const patterns: [number, [string, string], [string, string], string, string, number, number, number, number][] = [
    [0, ["Dallas", "TX"], ["Atlanta", "GA"], "Dry Van", "Corrugated boxes", 2450, 9, 9, 11],
    [0, ["Dallas", "TX"], ["Memphis", "TN"], "Dry Van", "Corrugated boxes", 1500, 21, 3, 25],
    [1, ["Fort Worth", "TX"], ["Nashville", "TN"], "Dry Van", "Furniture", 2100, 14, 6, 19],
    [2, ["Houston", "TX"], ["Oklahoma City", "OK"], "Flatbed", "Lumber", 1650, 12, 5, 4],
    [3, ["Laredo", "TX"], ["Chicago", "IL"], "Reefer", "Produce", 4200, 7, 8, 9],
    [4, ["Shreveport", "LA"], ["Dallas", "TX"], "Dry Van", "Paper rolls", 850, 30, 3, 52],
  ];
  for (const [ci, o, d, eq, com, rate, every, count, recent] of patterns) {
    for (let k = 0; k < count; k++) {
      const ago = recent + k * every;
      const pay = rate + ((k * 37) % 5) * 25 - 50;
      const carrier = carriers[(ci * 3 + k) % carriers.length];
      mem.loads.push(
        base({
          customer_id: customers[ci].id,
          customer_name: customers[ci].name,
          origin_city: o[0],
          origin_state: o[1],
          dest_city: d[0],
          dest_state: d[1],
          equipment: eq,
          commodity: com,
          weight_lbs: 38000 + ((k * 911) % 6) * 500,
          customer_rate: pay,
          covered_rate: Math.round(pay * 0.84),
          covered_by_carrier_id: carrier.id,
          covered_by_name: carrier.name,
          covered_via: "call",
          pickup_date: day(-ago),
          delivery_date: day(-ago + 2),
          covered_at: iso(ago + 1),
          created_at: iso(ago + 2),
        }),
      );
    }
  }

  // Two loads that need trucks right now.
  mem.loads.push(
    base({
      ref: "L-48213",
      customer_id: customers[0].id,
      customer_name: customers[0].name,
      origin_city: "Dallas",
      origin_state: "TX",
      dest_city: "Atlanta",
      dest_state: "GA",
      equipment: "Dry Van",
      commodity: "Corrugated boxes",
      weight_lbs: 39500,
      miles: 781,
      pickup_date: day(1),
      pickup_time: "08:00",
      delivery_date: day(3),
      customer_rate: 2500,
      target_rate: 1800,
      max_rate: 2150,
      status: "open",
      source: "upload",
      created_at: new Date(Date.now() - 20 * 60000).toISOString(),
    }),
    base({
      ref: "L-48219",
      customer_id: customers[2].id,
      customer_name: customers[2].name,
      origin_city: "Houston",
      origin_state: "TX",
      dest_city: "Oklahoma City",
      dest_state: "OK",
      equipment: "Flatbed",
      commodity: "Lumber",
      weight_lbs: 44000,
      miles: 446,
      pickup_date: day(2),
      delivery_date: day(3),
      customer_rate: 1700,
      target_rate: 1200,
      max_rate: 1450,
      special_instructions: "Tarps required.",
      status: "open",
      source: "manual",
      created_at: new Date(Date.now() - 55 * 60000).toISOString(),
    }),
  );

  mem.events.push({
    id: randomUUID(),
    type: "system",
    level: "info",
    message: "Command center online. Pick a load and press “Find a truck” to watch it work.",
    load_id: null,
    call_id: null,
    campaign_id: null,
    created_at: new Date().toISOString(),
  });
}
