/**
 * Apply master data defects as patches to the system-of-record files.
 *
 * Defects live in data/defects.json. Each patch has a path such as
 *   products.categories[id=household].aisle
 *   location.layouts[*].checkouts[id=L7].status
 * Segments: `name` (object key), `name[*]` (every array element),
 * `name[key=value]` (array elements whose key equals value). The last
 * segment is the field to set.
 *
 * The engine never receives a "dirty" flag. It only ever sees data.
 */

/**
 * Parse one path segment.
 * @param {string} seg
 * @returns {{key:string, filter:null|'*'|{field:string,value:string}}}
 */
function parseSegment(seg) {
  const m = /^([A-Za-z0-9_]+)(?:\[(\*|([A-Za-z0-9_]+)=([^\]]+))\])?$/.exec(seg);
  if (!m) throw new Error(`Invalid patch path segment '${seg}'.`);
  const [, key, bracket, field, value] = m;
  if (!bracket) return { key, filter: null };
  if (bracket === '*') return { key, filter: '*' };
  return { key, filter: { field, value } };
}

/**
 * Set `value` at `path` inside `root`, mutating it.
 * @returns {number} How many fields were set (0 means the path matched nothing).
 */
export function applyPatch(root, path, value) {
  const segs = path.split('.');
  const field = segs.pop();
  let nodes = [root];
  for (const raw of segs) {
    const { key, filter } = parseSegment(raw);
    const next = [];
    for (const node of nodes) {
      const child = node?.[key];
      if (child === undefined) continue;
      if (filter === null) next.push(child);
      else if (!Array.isArray(child)) throw new Error(`Patch path '${path}': '${key}' is not an array.`);
      else if (filter === '*') next.push(...child);
      else next.push(...child.filter((el) => String(el?.[filter.field]) === filter.value));
    }
    nodes = next;
  }
  for (const node of nodes) node[field] = value;
  return nodes.length;
}

/**
 * Return a patched deep copy of the masters with the chosen defects applied.
 * @param {{location:object, products:object}} masters System-of-record files.
 * @param {{defects:{id:string, patches:{path:string,value:unknown}[]}[]}} catalogue From defects.json.
 * @param {string[]} activeIds Defect ids to switch on.
 * @returns {{location:object, products:object}}
 * @throws {Error} If an id is unknown or a patch matches nothing.
 */
export function applyDefects(masters, catalogue, activeIds) {
  const copy = structuredClone({ location: masters.location, products: masters.products });
  for (const id of activeIds) {
    const defect = catalogue.defects.find((d) => d.id === id);
    if (!defect) throw new Error(`Unknown defect '${id}'.`);
    for (const p of defect.patches) {
      if (applyPatch(copy, p.path, p.value) === 0) {
        throw new Error(`Defect '${id}': patch path '${p.path}' matched nothing.`);
      }
    }
  }
  return copy;
}
