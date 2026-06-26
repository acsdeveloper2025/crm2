import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Location,
  Option,
  Paginated,
  RoleDimensionWiring,
  ScopeDimensionInfo,
  UserScopeAssignments,
} from '@crm2/sdk';
import { api, ApiError } from '../lib/sdk.js';
import { Button } from './ui/Button.js';

/**
 * The user dialog's ACCESS tab (ADR-0022 slice 6) — rendered DYNAMICALLY from the target role's
 * dimension wiring: one picker per active dimension, nothing hardcoded. Two modes (the profile-photo
 * pattern): EDIT (`userId` set) queries + mutates live; CREATE stages picks locally and the dialog
 * applies them after the user exists.
 */
export interface StagedScopeItem {
  entityId?: number;
  entityValue?: string;
  label: string;
}
export type StagedScope = Record<string, StagedScopeItem[]>;

interface Props {
  roleCode: string;
  dimensions: RoleDimensionWiring[];
  userId?: string;
  staged?: StagedScope;
  onStageChange?: (next: StagedScope) => void;
}

const LOCATION_PICK_LIMIT = 25;

const locationLabel = (l: Location): string => `${l.pincode} — ${l.area}, ${l.city}`;

/**
 * Territory is one operator concept (a pincode/area the user covers). We surface a SINGLE pincode/area
 * search instead of one block per location dimension. (CITY/STATE were removed from the scope catalog —
 * ADR-0072.)
 */
const LOCATION_DIMS = ['PINCODE', 'AREA'] as const;
const FOLDED_LOCATION_DIMS = ['PINCODE', 'AREA'] as const;

export function UserAccessSection({ roleCode, dimensions, userId, staged, onStageChange }: Props) {
  const qc = useQueryClient();
  const isEdit = !!userId;
  const [error, setError] = useState<string | null>(null);

  const catalog =
    useQuery({
      queryKey: ['roles', 'dimensions'],
      queryFn: () => api<ScopeDimensionInfo[]>('GET', '/api/v2/roles/dimensions'),
    }).data ?? [];

  const assignments =
    useQuery({
      queryKey: ['user-scope', userId],
      queryFn: () => api<UserScopeAssignments>('GET', `/api/v2/users/${userId}/scope-assignments`),
      enabled: isEdit,
    }).data ?? {};

  const add = useMutation({
    mutationFn: (input: { dimension: string; entityIds?: number[]; entityValues?: string[] }) =>
      api<UserScopeAssignments>('POST', `/api/v2/users/${userId}/scope-assignments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-scope', userId] }),
    onError: (e: unknown) =>
      setError(
        e instanceof ApiError && e.code === 'INVALID_REFERENCE'
          ? 'Unknown value — it must exist in the catalog.'
          : e instanceof ApiError && e.code === 'DIMENSION_NOT_ALLOWED_FOR_ROLE'
            ? 'This dimension is not enabled for the user’s role.'
            : e instanceof Error
              ? e.message
              : 'Assignment failed',
      ),
  });
  const remove = useMutation({
    mutationFn: (assignmentId: number) =>
      api<UserScopeAssignments>('DELETE', `/api/v2/users/${userId}/scope-assignments/${assignmentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-scope', userId] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Remove failed'),
  });

  if (dimensions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The role <span className="font-mono">{roleCode}</span> has no assignable scope dimensions. Enable
        dimensions for it on the Access Control screen first.
      </p>
    );
  }

  const stageAdd = (dimension: string, item: StagedScopeItem) => {
    const cur = staged?.[dimension] ?? [];
    const dup = cur.some(
      (x) =>
        (item.entityId !== undefined && x.entityId === item.entityId) ||
        (item.entityValue !== undefined && x.entityValue === item.entityValue),
    );
    if (!dup) onStageChange?.({ ...(staged ?? {}), [dimension]: [...cur, item] });
  };
  const stageRemove = (dimension: string, idx: number) => {
    const cur = staged?.[dimension] ?? [];
    onStageChange?.({ ...(staged ?? {}), [dimension]: cur.filter((_, i) => i !== idx) });
  };

  // Territory = the PINCODE/AREA dimensions folded into one picker; new picks land on AREA (exact
  // area_id match) when wired, else PINCODE. Everything else (CLIENT/PRODUCT) keeps its own block.
  const locationWirings = dimensions.filter((w) =>
    (LOCATION_DIMS as readonly string[]).includes(w.dimension),
  );
  const targetLocation =
    locationWirings.find((w) => w.dimension === 'AREA') ??
    locationWirings.find((w) => w.dimension === 'PINCODE');
  const otherDimensions = dimensions.filter(
    (w) => !(FOLDED_LOCATION_DIMS as readonly string[]).includes(w.dimension),
  );

  const locationChips: AssignedChip[] = locationWirings.flatMap((w) =>
    isEdit
      ? (assignments[w.dimension] ?? []).map((a) => ({
          key: `${w.dimension}-${a.id}`,
          label: a.label,
          onRemove: () => remove.mutate(a.id),
        }))
      : (staged?.[w.dimension] ?? []).map((s, i) => ({
          key: `${w.dimension}-${i}`,
          label: s.label,
          onRemove: () => stageRemove(w.dimension, i),
        })),
  );
  const locationRestricted = locationWirings.some((w) => w.mode === 'RESTRICT');

  return (
    <div className="space-y-4">
      {!isEdit && (
        <p className="text-xs text-muted-foreground">
          Selections are applied right after the user is created.
        </p>
      )}
      {targetLocation && (
        <LocationScopeBlock
          chips={locationChips}
          restricted={locationRestricted}
          onPick={(id, label) => {
            setError(null);
            if (isEdit) add.mutate({ dimension: targetLocation.dimension, entityIds: [id] });
            else stageAdd(targetLocation.dimension, { entityId: id, label });
          }}
        />
      )}
      {otherDimensions.map((w) => {
        const info = catalog.find((c) => c.code === w.dimension);
        return (
          <DimensionBlock
            key={w.dimension}
            wiring={w}
            info={info}
            assigned={
              isEdit
                ? (assignments[w.dimension] ?? []).map((a) => ({
                    key: a.id,
                    label: a.label,
                    onRemove: () => remove.mutate(a.id),
                  }))
                : (staged?.[w.dimension] ?? []).map((s, i) => ({
                    key: i,
                    label: s.label,
                    onRemove: () => stageRemove(w.dimension, i),
                  }))
            }
            onPickId={(id, label) => {
              setError(null);
              if (isEdit) add.mutate({ dimension: w.dimension, entityIds: [id] });
              else stageAdd(w.dimension, { entityId: id, label });
            }}
            onPickValue={(value) => {
              setError(null);
              if (isEdit) add.mutate({ dimension: w.dimension, entityValues: [value] });
              else stageAdd(w.dimension, { entityValue: value, label: value });
            }}
          />
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** The one folded territory block: a pincode/area search that adds continuously. */
function LocationScopeBlock({
  chips,
  restricted,
  onPick,
}: {
  chips: AssignedChip[];
  restricted: boolean;
  onPick: (id: number, label: string) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium text-foreground">Territory (pincode / area)</p>
      {restricted && chips.length === 0 && (
        <p className="mb-2 text-xs text-destructive">
          Nothing assigned — this user currently sees NO cases by territory.
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.length === 0 && <span className="text-xs text-muted-foreground">Nothing assigned.</span>}
        {chips.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {c.label}
            <button
              aria-label={`Remove ${c.label}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={c.onRemove}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <LocationPicker onPick={onPick} />
    </div>
  );
}

interface AssignedChip {
  key: string | number;
  label: string;
  onRemove: () => void;
}

function DimensionBlock({
  wiring,
  info,
  assigned,
  onPickId,
  onPickValue,
}: {
  wiring: RoleDimensionWiring;
  info: ScopeDimensionInfo | undefined;
  assigned: AssignedChip[];
  onPickId: (id: number, label: string) => void;
  onPickValue: (value: string) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{info?.label ?? wiring.dimension}</p>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            wiring.mode === 'RESTRICT'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary-hover'
          }`}
        >
          {wiring.mode}
        </span>
      </div>
      {wiring.mode === 'RESTRICT' && assigned.length === 0 && (
        <p className="mb-2 text-xs text-destructive">
          RESTRICT with nothing assigned — this user currently sees NO data for this dimension.
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {assigned.length === 0 && <span className="text-xs text-muted-foreground">Nothing assigned.</span>}
        {assigned.map((a) => (
          <span
            key={a.key}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
          >
            {a.label}
            <button
              aria-label={`Remove ${a.label}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={a.onRemove}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {info?.entityKind === 'VALUE' ? (
        <ValuePicker onPick={onPickValue} placeholder={`Add a ${info.label.toLowerCase()}…`} />
      ) : (
        <IdPicker dimension={wiring.dimension} onPick={onPickId} />
      )}
    </div>
  );
}

/** VALUE-kind (state/city): free text, validated server-side against the locations catalog. */
function ValuePicker({ onPick, placeholder }: { onPick: (v: string) => void; placeholder: string }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2">
      <input
        className="input flex-1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        disabled={!value.trim()}
        onClick={() => {
          onPick(value.trim());
          setValue('');
        }}
      >
        Add
      </Button>
    </div>
  );
}

/** ID-kind pickers: small catalogs come from /options feeds; locations are search-first (157k rows). */
function IdPicker({ dimension, onPick }: { dimension: string; onPick: (id: number, label: string) => void }) {
  if (dimension === 'PINCODE' || dimension === 'AREA') return <LocationPicker onPick={onPick} />;
  const feed =
    dimension === 'CLIENT'
      ? '/api/v2/clients/options'
      : dimension === 'PRODUCT'
        ? '/api/v2/products/options'
        : '/api/v2/verification-units/options';
  return <OptionsPicker feed={feed} onPick={onPick} />;
}

function OptionsPicker({ feed, onPick }: { feed: string; onPick: (id: number, label: string) => void }) {
  const options =
    useQuery({ queryKey: ['opts', feed], queryFn: () => api<Option[]>('GET', feed) }).data ?? [];
  const [picked, setPicked] = useState('');
  return (
    <div className="flex gap-2">
      <select className="input flex-1" value={picked} onChange={(e) => setPicked(e.target.value)}>
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.name}
          </option>
        ))}
      </select>
      <Button
        disabled={!picked}
        onClick={() => {
          const o = options.find((x) => String(x.id) === picked);
          if (o) onPick(o.id, o.name);
          setPicked('');
        }}
      >
        Add
      </Button>
    </div>
  );
}

function LocationPicker({ onPick }: { onPick: (id: number, label: string) => void }) {
  const [search, setSearch] = useState('');
  const results =
    useQuery({
      queryKey: ['loc-pick', search],
      queryFn: () =>
        api<Paginated<Location>>(
          'GET',
          `/api/v2/locations?search=${encodeURIComponent(search)}&limit=${LOCATION_PICK_LIMIT}`,
        ),
      enabled: search.trim().length >= 3,
    }).data?.items ?? [];
  return (
    <div className="space-y-2">
      <input
        className="input"
        value={search}
        placeholder="Search pincode or area (min 3 chars)…"
        onChange={(e) => setSearch(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
          {results.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between border-b border-border px-2 py-1 last:border-b-0"
            >
              <span className="text-xs text-foreground">{locationLabel(l)}</span>
              <Button variant="secondary" size="sm" onClick={() => onPick(l.id, locationLabel(l))}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
