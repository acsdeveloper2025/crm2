import { Link } from 'react-router-dom';
import { HexagonLoader } from '../../components/ui/HexagonLoader.js';
import { type Pair, pairKey, toggleUniversalExclusive } from './pairs.js';

/** The CPV mapping admin — where a dropped pair gets fixed. */
export const CPV_ADMIN_PATH = '/admin/cpv';
export const CPV_DROPPED_NOTE = "not in this client's CPV mapping";

export interface PairPickerOption {
  id: number;
  label: string;
}

export interface PairPickerProps {
  /** picked product ids; `null` = Universal (ADR-0071). Mutually exclusive with concrete ids. */
  products: (number | null)[];
  units: (number | null)[];
  productOptions: PairPickerOption[];
  /** already narrowed to the union of the picked products' CPV units (`unitOptionIds`). */
  unitOptions: PairPickerOption[];
  /** resolved, CPV-intersected slots — the truth the save will act on. */
  pairs: Pair[];
  /** rectangle members CPV rejected — surfaced so the count explains itself. */
  dropped: Pair[];
  labelFor: (p: Pair) => string;
  onProductsChange: (next: (number | null)[]) => void;
  onUnitsChange: (next: (number | null)[]) => void;
  isLoading?: boolean | undefined;
}

/** One tick-list axis: an explicit Universal chip + the concrete options, Universal XOR concrete. */
function Axis({
  legend,
  universalLabel,
  picked,
  options,
  onChange,
}: {
  legend: string;
  universalLabel: string;
  picked: (number | null)[];
  options: PairPickerOption[];
  onChange: (next: (number | null)[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 block text-xs font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <label
          title="Applies to every one of them — cannot be combined with a specific pick"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={picked.includes(null)}
            onChange={() => onChange(toggleUniversalExclusive(picked, null))}
          />
          {universalLabel}
        </label>
        {options.map((o) => (
          <label
            key={o.id}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-muted"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={picked.includes(o.id)}
              onChange={() => onChange(toggleUniversalExclusive(picked, o.id))}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Pick MANY products × MANY units for one client (a CPV group), and show the slots that actually
 * resolve. The two tick-lists describe a RECTANGLE; CPV is JAGGED, so the resolved pairs — not the
 * rectangle — are rendered as read-only chips and are what the caller counts and saves.
 */
export function PairPicker({
  products,
  units,
  productOptions,
  unitOptions,
  pairs,
  dropped,
  labelFor,
  onProductsChange,
  onUnitsChange,
  isLoading,
}: PairPickerProps) {
  return (
    <div className="space-y-4">
      <Axis
        legend="Products"
        universalLabel="Universal (all products)"
        picked={products}
        options={productOptions}
        onChange={onProductsChange}
      />
      <Axis
        legend="Verification units"
        universalLabel="Universal (all units)"
        picked={units}
        options={unitOptions}
        onChange={onUnitsChange}
      />
      {isLoading ? (
        <HexagonLoader operation="Checking CPV mapping" />
      ) : pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tick at least one product and one verification unit — each resolved pair below is one slot.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <p className="text-xs font-medium text-foreground">These slots will be priced:</p>
          <div className="flex flex-wrap gap-2">
            {pairs.map((p) => (
              <span
                key={pairKey(p)}
                className="inline-flex items-center rounded-full border border-border-strong bg-card px-3 py-1.5 text-xs"
              >
                {labelFor(p)}
              </span>
            ))}
          </div>
        </div>
      )}
      {dropped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="tabular-nums">{dropped.length}</span> pair{dropped.length === 1 ? '' : 's'}{' '}
          {CPV_DROPPED_NOTE} and {dropped.length === 1 ? 'was' : 'were'} left out:{' '}
          {dropped.map(labelFor).join(', ')} —{' '}
          <Link to={CPV_ADMIN_PATH} className="text-primary hover:underline">
            map {dropped.length === 1 ? 'it' : 'them'} in CPV
          </Link>
          .
        </p>
      )}
    </div>
  );
}
