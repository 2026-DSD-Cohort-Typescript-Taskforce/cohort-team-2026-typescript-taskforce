// The browser's calls to the app's property routes (DC-83). Each returns the data, a failure
// with a readable message, or null while apiFetch sends the user to /login.

import { call, sendJson } from './bill-api';
import type { Property, PropertyInput } from './properties';

type One = { property: Property };
const one = (body: One) => body.property;

export function loadProperties() {
  return call(
    '/api/properties',
    undefined,
    (body: { properties: Property[] }) => body.properties,
    "Couldn't load the properties. Try again.",
  );
}

export function createProperty(input: PropertyInput) {
  return call(
    '/api/properties',
    sendJson('POST', input),
    one,
    "Couldn't create the property. Try again.",
  );
}

export function updateProperty(id: number, input: PropertyInput) {
  return call(
    `/api/properties/${id}`,
    sendJson('PATCH', input),
    one,
    "Couldn't save the property. Try again.",
  );
}

export function deleteProperty(id: number) {
  return call(
    `/api/properties/${id}`,
    { method: 'DELETE' },
    one,
    "Couldn't delete the property. Try again.",
  );
}
