/**
 * @crm2/sdk — reverse geocoding (ADR-0026). Coord → human address for the Field Monitoring console.
 * `address` is null when the deployment has no Google key or Google returned nothing; the UI then
 * shows raw coords + a Maps link. `cached` is true when served from the frozen coordinate cache.
 */
export interface ReverseGeocodeResult {
  address: string | null;
  cached: boolean;
}

/** One open reverse-geocode dead-letter row (ADR-0040 S4 Slice B) — a field-photo geocode that
 *  exhausted retries, awaiting bulk replay. Ops/SA only. */
export interface ReverseGeocodeDlqRow {
  id: string;
  attachmentId: string;
  lat: number;
  lng: number;
  error: string;
  attempts: number;
  createdAt: string;
}
