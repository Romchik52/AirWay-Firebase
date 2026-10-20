export const routeTemplates = [
  { airline:"Air Astana", flightNumber:"KC-207", from:"ALA", fromCity:"Алматы", to:"DXB", toCity:"Дубай", departureTime:"09:30", arrivalTime:"13:10", duration:"4ч 40м", price:85000, baggage:"20 кг", class:"Economy", stops:0 },
  { airline:"FlyDubai", flightNumber:"FZ-1720", from:"ALA", fromCity:"Алматы", to:"DXB", toCity:"Дубай", departureTime:"16:20", arrivalTime:"20:10", duration:"4ч 50м", price:72000, baggage:"20 кг", class:"Economy", stops:0 },
  { airline:"Air Astana", flightNumber:"KC-911", from:"ALA", fromCity:"Алматы", to:"IST", toCity:"Стамбул", departureTime:"07:45", arrivalTime:"12:10", duration:"6ч 25м", price:99000, baggage:"23 кг", class:"Economy", stops:0 },
  { airline:"Turkish Airlines", flightNumber:"TK-351", from:"ALA", fromCity:"Алматы", to:"IST", toCity:"Стамбул", departureTime:"13:25", arrivalTime:"18:05", duration:"6ч 40м", price:112000, baggage:"23 кг", class:"Economy", stops:0 },
  { airline:"Air Astana", flightNumber:"KC-851", from:"ALA", fromCity:"Алматы", to:"TAS", toCity:"Ташкент", departureTime:"10:15", arrivalTime:"11:55", duration:"1ч 40м", price:54000, baggage:"20 кг", class:"Economy", stops:0 },
  { airline:"Uzbekistan Airways", flightNumber:"HY-762", from:"ALA", fromCity:"Алматы", to:"TAS", toCity:"Ташкент", departureTime:"18:30", arrivalTime:"20:10", duration:"1ч 40м", price:61000, baggage:"20 кг", class:"Economy", stops:0 },
  { airline:"Air Astana", flightNumber:"KC-895", from:"ALA", fromCity:"Алматы", to:"LHR", toCity:"Лондон", departureTime:"06:50", arrivalTime:"13:55", duration:"9ч 05м", price:215000, baggage:"23 кг", class:"Economy", stops:1 },
  { airline:"Air Astana", flightNumber:"KC-991", from:"ALA", fromCity:"Алматы", to:"ICN", toCity:"Сеул", departureTime:"00:35", arrivalTime:"10:20", duration:"6ч 45м", price:178000, baggage:"23 кг", class:"Economy", stops:0 },
  { airline:"Qatar Airways", flightNumber:"QR-392", from:"ALA", fromCity:"Алматы", to:"DOH", toCity:"Доха", departureTime:"04:25", arrivalTime:"07:10", duration:"4ч 45м", price:134000, baggage:"25 кг", class:"Economy", stops:0 },
  { airline:"Air Astana", flightNumber:"KC-925", from:"ALA", fromCity:"Алматы", to:"PEK", toCity:"Пекин", departureTime:"21:15", arrivalTime:"04:55", duration:"4ч 40м", price:121000, baggage:"23 кг", class:"Economy", stops:0 },
  { airline:"SCAT Airlines", flightNumber:"DV-701", from:"ALA", fromCity:"Алматы", to:"MOW", toCity:"Москва", departureTime:"08:20", arrivalTime:"11:55", duration:"4ч 35м", price:76000, baggage:"20 кг", class:"Economy", stops:0 },
  { airline:"Air Astana", flightNumber:"KC-713", from:"NQZ", fromCity:"Астана", to:"ALA", toCity:"Алматы", departureTime:"08:00", arrivalTime:"09:35", duration:"1ч 35м", price:32000, baggage:"20 кг", class:"Economy", stops:0 }
];

export function dateKey(value) {
  if (!value) return new Date().toISOString().slice(0,10);
  if (typeof value === "string") return value.slice(0,10);
  if (value?.toDate) return value.toDate().toISOString().slice(0,10);
  const d = new Date(value); return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
}

export function makeDemoFlights(date = dateKey()) {
  return routeTemplates.map((t, i) => ({
    id: `demo-${i + 1}-${date}`,
    ...t,
    departureDate: date,
    seats: 8 + ((i * 7) % 21),
    totalSeats: 8 + ((i * 7) % 21),
    status: "available",
    description: `Демонстрационный вариант рейса ${t.fromCity} — ${t.toCity}.`
  }));
}

export function findDemoFlight(id) {
  const match = String(id || "").match(/^demo-(\d+)-/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  const date = String(id).match(/-(\d{4}-\d{2}-\d{2})$/)?.[1] || dateKey();
  return routeTemplates[index] ? makeDemoFlights(date)[index] : null;
}
