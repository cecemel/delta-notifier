const normalizeDate = process.env["NORMALIZE_DATETIME_IN_QUAD"];

export default function(quad) {
  if (normalizeDate && quad.object.datatype == 'http://www.w3.org/2001/XMLSchema#dateTime') {
    quad.object.value = new Date(Date.parse(quad.object.value)).toISOString();
  }

  return quad;
}
