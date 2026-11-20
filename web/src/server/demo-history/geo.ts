import type { Rng } from "./prng";

/**
 * Neighbourhood centres (approximate) of the platform's cities — the generator scatters parcels around them. Everything built on top (street, building
 * number, recipient, phone) is fictitious.
 */
export type Place = readonly [name: string, lat: number, lng: number];

export const DISTRICTS: Record<string, readonly Place[]> = {
  riyadh: [
    ["Al Olaya", 24.6937, 46.685], ["Al Malaz", 24.665, 46.73], ["Al Sulimaniyah", 24.7, 46.7], ["Al Nakheel", 24.74, 46.63], ["Hittin", 24.77, 46.605],
    ["Al Yasmin", 24.823, 46.643], ["Al Malqa", 24.81, 46.6], ["Al Rawdah", 24.73, 46.77], ["Al Naseem", 24.73, 46.83], ["Al Aziziyah", 24.56, 46.75],
    ["Al Shifa", 24.57, 46.7], ["As Sahafah", 24.8, 46.63], ["Qurtubah", 24.81, 46.735], ["Al Wadi", 24.785, 46.68], ["Al Murabba", 24.65, 46.71], ["Al Worood", 24.715, 46.675],
    ["Al Narjis", 24.84, 46.66], ["Al Rabwah", 24.68, 46.74], ["Al Munsiyah", 24.77, 46.8], ["Laban", 24.62, 46.57],
  ],
  jeddah: [
    ["Al Rawdah", 21.5694, 39.1637], ["Al Hamra", 21.518, 39.167], ["Al Salamah", 21.6, 39.15], ["Al Safa", 21.58, 39.2], ["Al Zahraa", 21.6, 39.12], ["Al Naeem", 21.6, 39.16],
    ["Al Marwah", 21.62, 39.19], ["Al Aziziyah", 21.52, 39.2], ["Al Shati", 21.62, 39.11], ["Obhur", 21.74, 39.11], ["Al Basateen", 21.55, 39.18], ["Al Faisaliyah", 21.54, 39.15],
  ],
  dammam: [
    ["Al Faisaliyah", 26.42, 50.1], ["Al Shati", 26.45, 50.12], ["Al Nuzha", 26.4, 50.08], ["Al Adamah", 26.38, 50.03], ["Al Mazruiyah", 26.43, 50.0], ["Al Badiyah", 26.36, 50.07],
    ["Uhud", 26.41, 50.05], ["Al Jalawiyah", 26.44, 50.07],
  ],
  khobar: [["Al Aqrabiyah", 26.29, 50.2], ["Al Rakah", 26.31, 50.19], ["Al Ulaya", 26.27, 50.21], ["Al Yarmouk", 26.26, 50.17], ["Al Khobar Shamaliyah", 26.33, 50.2]],
  makkah: [["Al Awali", 21.38, 39.85], ["Al Shawqiyah", 21.34, 39.78], ["Al Aziziyah", 21.4, 39.87], ["Al Zahir", 21.41, 39.83], ["Al Nuzhah", 21.44, 39.86]],
  madinah: [["Quba", 24.44, 39.62], ["Al Aziziyah", 24.47, 39.61], ["Al Khalidiyah", 24.5, 39.58], ["Al Anabis", 24.52, 39.59], ["Al Hijra", 24.48, 39.66]],
  tabuk: [["Al Murooj", 28.4, 36.58], ["Al Rawdah", 28.38, 36.55], ["Al Faisaliyah", 28.37, 36.52], ["Al Sulaymaniyah", 28.41, 36.6]],
  abha: [["Al Mansak", 18.22, 42.5], ["Al Nahda", 18.24, 42.52], ["Al Manhal", 18.21, 42.54], ["Al Mahalah", 18.23, 42.49]],
  buraydah: [["Al Naqa", 26.34, 43.97], ["Al Rawdah", 26.31, 43.99], ["Al Khalidiyah", 26.35, 43.94], ["Al Iskan", 26.33, 43.96]],
};

export const STREETS = ["King Fahd Rd", "Olaya St", "King Abdullah Rd", "Prince Sultan Rd", "Takhassusi St", "Al Urubah Rd", "Imam Saud bin Abdulaziz Rd", "Abu Bakr Al Siddiq Rd",
  "Uthman bin Affan Rd", "Anas bin Malik Rd", "Prince Turki bin Abdulaziz Rd", "Salah Ad Din Rd", "King Salman Rd", "Al Imam Ahmad bin Hanbal St", "Tahlia St", "Al Thumama Rd", "Khurais Rd", "Makkah Rd"];
export const STREETS_AR = ["طريق الملك فهد", "شارع العليا", "طريق الملك عبدالله", "طريق الأمير سلطان", "شارع التخصصي", "طريق العروبة", "طريق الإمام سعود بن عبدالعزيز", "طريق أبو بكر الصديق",
  "طريق عثمان بن عفان", "طريق أنس بن مالك", "شارع التحلية", "طريق خريص", "طريق مكة"];

export const districtsOf = (city: string): readonly Place[] => DISTRICTS[city] ?? DISTRICTS.riyadh;

/** A point near a district centre (≈ ±1 km), so the same district yields different pins. */
export function jitter(rng: Rng, lat: number, lng: number, km = 1.2): { lat: number; lng: number } {
  const dLat = (rng.next() - 0.5) * 2 * (km / 111.2), dLng = (rng.next() - 0.5) * 2 * (km / (111.2 * Math.cos((lat * Math.PI) / 180)));
  return { lat: Math.round((lat + dLat) * 1e6) / 1e6, lng: Math.round((lng + dLng) * 1e6) / 1e6 };
}

const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Warehouse areas of Riyadh (industrial / logistics zones): where businesses keep their stock. */
export const WAREHOUSE_AREAS: readonly Place[] = [
  ["Al Sulay", 24.6, 46.82], ["Second Industrial City", 24.58, 46.84], ["Al Faisaliyah Industrial", 24.55, 46.78], ["Al Malaz", 24.665, 46.73], ["Al Nakheel", 24.74, 46.63],
  ["Al Aziziyah", 24.56, 46.75], ["Exit 18", 24.8, 46.78], ["Al Worood", 24.715, 46.675], ["Al Shifa", 24.57, 46.7], ["Ad Dar Al Baida", 24.51, 46.73],
];
