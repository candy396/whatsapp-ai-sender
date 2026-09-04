const csv = require('csv-parser');
const Readable = require('stream').Readable;

function parseCSVBuffer(buffer) {
  return new Promise((resolve, reject) => {
    let content = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!content) return resolve([]);

    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return resolve([]);

    const firstLineCols = lines[0].split(',').map(c => c.trim().replace(/^["']|["']$/g, '').replace(/^\uFEFF/, ''));
    const firstColDigits = (firstLineCols[0] || '').replace(/[^0-9]/g, '');

    // Check if the first line is actually data (a phone number >= 7 digits) instead of a header title
    const isFirstLineData = firstColDigits.length >= 7;

    if (isFirstLineData) {
      // Parse manually without losing the 1st row as header
      const results = lines.map(line => {
        const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, '').replace(/^\uFEFF/, ''));
        return {
          phone: parts[0] || '',
          name: parts[1] || '',
          notes: parts[2] || ''
        };
      });
      return resolve(results);
    }

    // Standard CSV with headers (e.g. "phone,name,notes")
    const results = [];
    const stream = Readable.from(Buffer.from(content));

    stream
      .pipe(csv())
      .on('data', (data) => {
        const normalized = {};
        for (const [key, value] of Object.entries(data)) {
          if (key) {
            const cleanKey = key.replace(/^\uFEFF/, '').trim().toLowerCase();
            normalized[cleanKey] = (value || '').trim();
          }
        }
        results.push(normalized);
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

function parseJSONString(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) {
      throw new Error('JSON data must be an array of client objects');
    }
    return data;
  } catch (error) {
    throw new Error(`Invalid JSON format: ${error.message}`);
  }
}

module.exports = {
  parseCSVBuffer,
  parseJSONString
};
