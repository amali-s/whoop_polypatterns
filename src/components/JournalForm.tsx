import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Input, Label, Textarea } from './form';
import { ErrorState } from './states';
import {
  ALCOHOL_DRINKS_MAX,
  ALCOHOL_DRINKS_MIN,
  CAFFEINE_SERVINGS_MAX,
  CAFFEINE_SERVINGS_MIN,
  CRAMP_LEVELS,
  DISCHARGE_LEVELS,
  JOURNAL_QUESTIONS,
  type CrampLevel,
  type DischargeLevel,
  type JournalAnswers,
  type JournalQuestionKey,
  type PeriodAnswer,
} from '../../api/_lib/journal-types';
import './components.css';

/**
 * The daily questionnaire (Phase 5.2) — the form half of Phase 5, and the
 * first consumer of `api/_lib/journal-types.ts`.
 *
 * SELF-CONTAINED BY DESIGN: it takes a day and its (optional) existing answers
 * as props and hands a complete `JournalAnswers` back through `onSubmit`. It
 * performs no I/O and knows nothing about Supabase, `/api/journal`, or how the
 * answers are stored — 5.3 wires a real load/save around it without editing
 * this file. "One entry per day" and "edit today" are therefore properties of
 * the CALLER (the DB's `unique (user_id, day)`), which this form expresses by
 * being a single editable snapshot of one `day`, pre-filled from
 * `initialAnswers`, not an append-only log.
 *
 * ── NULL DISCIPLINE IS THE WHOLE POINT ──────────────────────────────────────
 * Every answer is `T | null` and `null` means NOT ANSWERED — never `false`,
 * never `0`, never `'none'` (see journal-types.ts's header, and `src/lib/cycle.ts`
 * for what a fabricated `period: 'no'` would do to cycle detection). That rules
 * out the obvious controls:
 *
 * - NO CHECKBOXES for `hydrated` / `afternoon_snack` / `traveled`. A checkbox
 *   is a two-state control; once touched it can only say true or false, so
 *   "unanswered" would be unrepresentable and the form would invent a `false`
 *   the user never gave. They are tri-state radiogroups instead.
 * - The closed vocabularies (`cramps`, `discharge`) need a FIFTH state beyond
 *   their four levels, because `'none'` ("no cramps today") and `null` ("didn't
 *   say") are different facts.
 * - Empty number inputs stay `null`; `0` is an answered "none". `Number('')` is
 *   `0`, which is exactly the coercion that would erase that distinction, so
 *   the count fields hold RAW STRINGS in state and only parse on submit.
 *
 * DEVIATION, FLAGGED: the brief described the four-level chip groups as
 * supporting "no chip selected" as the fifth state. This ships them the same
 * way as the tri-states — an explicit, selectable "Not answered" chip — rather
 * than as a group with nothing checked. Reason: a radio that is merely
 * unchecked has no keyboard route back to unchecked once a chip is picked
 * (radios don't deselect, and inventing a Delete-to-clear key would be
 * undiscoverable), so "no chip selected" would be a state a mouse user could
 * never return to and a keyboard user could never reach at all — the precise
 * data-corruption failure the requirement exists to prevent. Making `null` a
 * first-class option keeps it reachable by every input modality, keeps all five
 * question groups on ONE idiom, and keeps `aria-checked` honest.
 *
 * ── ACCESSIBILITY (design.md §5.1's shell rules) ────────────────────────────
 * §5.2's chart contract does not apply — this is a form, not a chart.
 * - Each group is a `<fieldset>` + `<legend>` wrapping a `role="radiogroup"`
 *   (named by the legend) of native `<button role="radio">` elements with
 *   `aria-checked`. The interaction model is copied from `RangeToggle.tsx`, not
 *   reinvented: ROVING TABINDEX (one Tab stop per group, arrows move within),
 *   SELECTION FOLLOWS FOCUS, Home/End jump to the ends.
 * - Every other control has a real `<label for>`; unit/format hints and error
 *   text are linked with `aria-describedby`, invalid fields carry
 *   `aria-invalid`, and error text is `role="alert"` (the `ErrorState`
 *   precedent). A failed submit moves focus to the first invalid field.
 * - Tap targets: chips are `min-height: 44px` (they are too tall to need
 *   `.ui-btn`'s `::after` extension); `.ui-input`/`.ui-textarea` already carry
 *   the 44px floor from 3.4; the submit button is a `.ui-btn`.
 * - Chip borders are `--color-muted` (5.42:1), never `--color-border` — §5.1
 *   forbids the hairline as a control's only boundary — and selection is
 *   conveyed by `aria-checked` as well as the accent fill, so color is never
 *   the only signal. Chip transitions are gated on `prefers-reduced-motion`.
 * - Tokens only; no new colors.
 */

export interface JournalFormProps {
  /** The calendar day being logged, ISO 'YYYY-MM-DD'. Callers pass today. */
  day: string;
  /**
   * Existing answers for `day`, for edit-today. `undefined` = a fresh entry
   * (every field starts `null`). Pass a STABLE reference — the form re-seeds
   * its state whenever this reference or `day` changes, so an object rebuilt
   * inline on every parent render would discard in-progress typing.
   */
  initialAnswers?: JournalAnswers;
  /** Receives a complete `JournalAnswers` (all ten keys, `null` for unanswered). */
  onSubmit: (answers: JournalAnswers) => Promise<void> | void;
  /** Caller-owned save-in-flight flag; disables the submit button. */
  submitting?: boolean;
  /** Caller-owned save failure, rendered as the shell's `ErrorState`. */
  submitError?: string | null;
}

// ── Option lists ────────────────────────────────────────────────────────────
// Built from the locked vocabularies in journal-types.ts — the levels and their
// ORDER come from CRAMP_LEVELS / DISCHARGE_LEVELS, never retyped here.

interface ChoiceOption<T> {
  /** `null` is a real, selectable option: "not answered". */
  value: T | null;
  label: string;
}

const NOT_ANSWERED_LABEL = 'Not answered';

const BOOLEAN_OPTIONS: readonly ChoiceOption<boolean>[] = [
  { value: null, label: NOT_ANSWERED_LABEL },
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

// Same tri-state idiom, mapped to PeriodAnswer's literal strings rather than
// booleans — journal-types.ts stores 'yes' | 'no' | null so it mirrors
// src/lib/cycle.ts's PeriodLog verbatim.
const PERIOD_OPTIONS: readonly ChoiceOption<PeriodAnswer>[] = [
  { value: null, label: NOT_ANSWERED_LABEL },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function levelOptions<T extends string>(levels: readonly T[]): readonly ChoiceOption<T>[] {
  return [
    { value: null, label: NOT_ANSWERED_LABEL },
    ...levels.map((level) => ({ value: level, label: level[0].toUpperCase() + level.slice(1) })),
  ];
}

const CRAMP_OPTIONS = levelOptions<CrampLevel>(CRAMP_LEVELS);
const DISCHARGE_OPTIONS = levelOptions<DischargeLevel>(DISCHARGE_LEVELS);

// ── Form state ──────────────────────────────────────────────────────────────
/**
 * Mirrors `JournalAnswers` except for the two counts and the note, which are
 * held as RAW STRINGS: '' is how the DOM reports an empty number input, and it
 * must survive to submit as `null` rather than being coerced to `0`.
 * `extra` is absent on purpose — it has no UI and is passed straight through.
 */
interface FormState {
  hydrated: boolean | null;
  cramps: CrampLevel | null;
  period: PeriodAnswer | null;
  discharge: DischargeLevel | null;
  afternoon_snack: boolean | null;
  traveled: boolean | null;
  caffeine_servings: string;
  alcohol_drinks: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  hydrated: null,
  cramps: null,
  period: null,
  discharge: null,
  afternoon_snack: null,
  traveled: null,
  caffeine_servings: '',
  alcohol_drinks: '',
  notes: '',
};

/** `null` count → '' (an empty box), `0` → '0' (an answered "none"). */
function countToRaw(value: number | null): string {
  return value === null ? '' : String(value);
}

function toFormState(answers: JournalAnswers | undefined): FormState {
  if (!answers) {
    return EMPTY_FORM;
  }
  return {
    hydrated: answers.hydrated,
    cramps: answers.cramps,
    period: answers.period,
    discharge: answers.discharge,
    afternoon_snack: answers.afternoon_snack,
    traveled: answers.traveled,
    caffeine_servings: countToRaw(answers.caffeine_servings),
    alcohol_drinks: countToRaw(answers.alcohol_drinks),
    notes: answers.notes ?? '',
  };
}

// ── Validation ──────────────────────────────────────────────────────────────
type CountResult = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Parse one count field against the bounds journal-types.ts mirrors off the
 * 0004 CHECK constraints — so a bad value is rejected here with visible text
 * rather than clamped silently or bounced by Postgres.
 *
 * The empty check comes FIRST and returns `null`, never `0`: `Number('')` is
 * `0`, and letting that through would turn "didn't answer" into "answered
 * none".
 */
function parseCount(raw: string, min: number, max: number): CountResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    return { ok: false, error: 'Enter a whole number, or leave it blank.' };
  }
  if (parsed < min || parsed > max) {
    return { ok: false, error: `Enter a number between ${min} and ${max}, or leave it blank.` };
  }
  return { ok: true, value: parsed };
}

// ── Controls ────────────────────────────────────────────────────────────────
interface ChoiceGroupProps<T> {
  legend: string;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
}

/**
 * A nullable single-choice group: `<fieldset>`/`<legend>` around a
 * `role="radiogroup"` of `role="radio"` buttons, with the roving-tabindex +
 * arrow-key model lifted from `RangeToggle.tsx`. Generic over the answer type
 * so one control serves booleans, `PeriodAnswer`, `CrampLevel` and
 * `DischargeLevel`; `null` is always one of the options.
 */
function ChoiceGroup<T>({ legend, options, value, onChange }: ChoiceGroupProps<T>) {
  const legendId = useId();
  // Needed to move DOM focus with the selection when arrowing — the roving
  // tabIndex alone changes what's tabbable, not what's focused.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const foundIndex = options.findIndex((option) => option.value === value);
  // Every group includes a null option, so this normally resolves; the fallback
  // keeps exactly one Tab stop even if a caller passes an off-vocabulary value.
  const tabbableIndex = foundIndex === -1 ? 0 : foundIndex;

  function select(index: number) {
    const next = options[index];
    if (!next) {
      return;
    }
    onChange(next.value);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      // Both axes are mapped: the chips wrap into rows, but the radiogroup
      // pattern expects Up/Down to work regardless of orientation.
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        select((index + 1) % options.length);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        select((index - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <fieldset className="journal-field">
      <legend id={legendId} className="ui-label journal-legend">
        {legend}
      </legend>
      <div role="radiogroup" aria-labelledby={legendId} className="journal-choices">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === tabbableIndex ? 0 : -1}
              className={cx('journal-choice', selected && 'journal-choice-selected')}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface CountFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (raw: string) => void;
  min: number;
  max: number;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * A bounded whole-number field whose EMPTY state is meaningful. Value stays a
 * string all the way to submit (see `parseCount`); `min`/`max`/`step` are set
 * for the mobile keypad and spinner, but the form is `noValidate` — this
 * component's own `role="alert"` text is the single error channel, so native
 * bubbles never compete with it.
 */
function CountField({ label, hint, value, onChange, min, max, error, inputRef }: CountFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  return (
    <div className="journal-field">
      <Label htmlFor={inputId}>{label}</Label>
      <p id={hintId} className="journal-hint">
        {hint}
      </p>
      <Input
        ref={inputRef}
        id={inputId}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={value}
        placeholder={NOT_ANSWERED_LABEL}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== null && (
        <p id={errorId} className="journal-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Day label ───────────────────────────────────────────────────────────────
/**
 * 'YYYY-MM-DD' → a readable date. Parsed as UTC and formatted in UTC on
 * purpose: `new Date('2026-07-30')` is midnight UTC, so formatting it in a
 * behind-UTC local zone would render the day BEFORE the one being logged.
 */
function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) {
    return day;
  }
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

// ── The form ────────────────────────────────────────────────────────────────
export function JournalForm({
  day,
  initialAnswers,
  onSubmit,
  submitting = false,
  submitError = null,
}: JournalFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialAnswers));
  const [errors, setErrors] = useState<{ caffeine: string | null; alcohol: string | null }>({
    caffeine: null,
    alcohol: null,
  });
  const [saved, setSaved] = useState(false);
  // Re-seed from props when the caller hands us a different day or a different
  // answers object (5.3: an async load landing after mount). Adjusting state
  // during render is React's documented alternative to a reset effect — it
  // re-renders before committing, and storing the new identity here is what
  // stops it looping.
  const [seed, setSeed] = useState<{ day: string; answers: JournalAnswers | undefined }>({
    day,
    answers: initialAnswers,
  });
  if (seed.day !== day || seed.answers !== initialAnswers) {
    setSeed({ day, answers: initialAnswers });
    setForm(toFormState(initialAnswers));
    setErrors({ caffeine: null, alcohol: null });
    setSaved(false);
  }

  const introId = useId();
  const notesId = useId();
  const caffeineRef = useRef<HTMLInputElement | null>(null);
  const alcoholRef = useRef<HTMLInputElement | null>(null);
  const dayLabel = formatDay(day);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const caffeine = parseCount(
      form.caffeine_servings,
      CAFFEINE_SERVINGS_MIN,
      CAFFEINE_SERVINGS_MAX,
    );
    const alcohol = parseCount(form.alcohol_drinks, ALCOHOL_DRINKS_MIN, ALCOHOL_DRINKS_MAX);
    setErrors({
      caffeine: caffeine.ok ? null : caffeine.error,
      alcohol: alcohol.ok ? null : alcohol.error,
    });
    if (!caffeine.ok || !alcohol.ok) {
      // Send focus to the first field the user has to fix, so the alert isn't
      // something only a sighted user notices.
      (caffeine.ok ? alcoholRef : caffeineRef).current?.focus();
      return;
    }

    const notes = form.notes.trim();
    const answers: JournalAnswers = {
      hydrated: form.hydrated,
      cramps: form.cramps,
      period: form.period,
      discharge: form.discharge,
      afternoon_snack: form.afternoon_snack,
      traveled: form.traveled,
      caffeine_servings: caffeine.value,
      alcohol_drinks: alcohol.value,
      notes: notes === '' ? null : notes,
      // PASSTHROUGH ONLY: `extra` is the schema's no-migration escape hatch and
      // has no UI. Round-trip whatever the caller loaded so editing a day can
      // never drop a field this form doesn't know about.
      extra: initialAnswers?.extra ?? null,
    };

    try {
      await onSubmit(answers);
      setSaved(true);
    } catch {
      // The caller owns the user-visible failure message (`submitError`); this
      // catch exists so a rejected save doesn't become an unhandled rejection
      // or a false "Saved".
      setSaved(false);
    }
  }

  /**
   * Rendered in `JOURNAL_QUESTIONS` order, driven by the array itself — the
   * order and the labels are read off the locked contract rather than retyped,
   * and the exhaustive switch means adding a ninth question there is a compile
   * error here, not a silently missing control.
   */
  function renderQuestion(key: JournalQuestionKey, label: string): ReactElement {
    switch (key) {
      case 'hydrated':
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={BOOLEAN_OPTIONS}
            value={form.hydrated}
            onChange={(value) => update('hydrated', value)}
          />
        );
      case 'cramps':
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={CRAMP_OPTIONS}
            value={form.cramps}
            onChange={(value) => update('cramps', value)}
          />
        );
      case 'period':
        // TODO(5.3+): the once-only "typical cycle length" question belongs
        // HERE, triggered the first time this control is answered 'yes'
        // (ROADMAP 5.1 constraint 2 — the app never assumes 28). It is
        // deliberately NOT built in 5.2: it writes `user_settings`
        // (typical_cycle_length + typical_cycle_length_asked_at) and must first
        // READ whether it has already been asked, or a user who declined gets
        // re-prompted on every future period day — and there is no API to ask
        // yet. The answer feeds `PeriodMeterTile`'s `typicalCycleLength` prop
        // UNRESOLVED; `cycleState()` already implements the precedence rule
        // (an estimate from ≥2 logged episodes wins over the stored value).
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={PERIOD_OPTIONS}
            value={form.period}
            onChange={(value) => update('period', value)}
          />
        );
      case 'discharge':
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={DISCHARGE_OPTIONS}
            value={form.discharge}
            onChange={(value) => update('discharge', value)}
          />
        );
      case 'afternoon_snack':
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={BOOLEAN_OPTIONS}
            value={form.afternoon_snack}
            onChange={(value) => update('afternoon_snack', value)}
          />
        );
      case 'traveled':
        return (
          <ChoiceGroup
            key={key}
            legend={label}
            options={BOOLEAN_OPTIONS}
            value={form.traveled}
            onChange={(value) => update('traveled', value)}
          />
        );
      case 'caffeine_servings':
        return (
          <CountField
            key={key}
            label={label}
            hint={`Servings, ${CAFFEINE_SERVINGS_MIN}–${CAFFEINE_SERVINGS_MAX}. Blank means not answered; 0 means none.`}
            value={form.caffeine_servings}
            onChange={(raw) => {
              update('caffeine_servings', raw);
              setErrors((prev) => ({ ...prev, caffeine: null }));
            }}
            min={CAFFEINE_SERVINGS_MIN}
            max={CAFFEINE_SERVINGS_MAX}
            error={errors.caffeine}
            inputRef={caffeineRef}
          />
        );
      case 'alcohol_drinks':
        return (
          <CountField
            key={key}
            label={label}
            hint={`Drinks, ${ALCOHOL_DRINKS_MIN}–${ALCOHOL_DRINKS_MAX}. Blank means not answered; 0 means none.`}
            value={form.alcohol_drinks}
            onChange={(raw) => {
              update('alcohol_drinks', raw);
              setErrors((prev) => ({ ...prev, alcohol: null }));
            }}
            min={ALCOHOL_DRINKS_MIN}
            max={ALCOHOL_DRINKS_MAX}
            error={errors.alcohol}
            inputRef={alcoholRef}
          />
        );
      default: {
        const exhaustive: never = key;
        return exhaustive;
      }
    }
  }

  return (
    <form
      className="journal-form"
      // We own validation end to end: native constraint bubbles would compete
      // with the linked role="alert" text and can't express "blank is fine".
      noValidate
      aria-label={`Daily journal for ${dayLabel}`}
      aria-describedby={introId}
      onSubmit={handleSubmit}
    >
      <p className="journal-day">
        <time dateTime={day}>{dayLabel}</time>
      </p>
      <p id={introId} className="journal-hint">
        Nothing is required. Leave anything you didn’t track as “{NOT_ANSWERED_LABEL}” — a blank
        answer is stored as unknown, never as “no”.
      </p>

      {JOURNAL_QUESTIONS.map((question) => renderQuestion(question.key, question.label))}

      {/* Not one of the eight questions — `notes` is the schema's free-text
          field, so its label is local rather than read from JOURNAL_QUESTIONS. */}
      <div className="journal-field">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea
          id={notesId}
          rows={3}
          value={form.notes}
          placeholder="Anything else about today"
          onChange={(event) => update('notes', event.target.value)}
        />
      </div>

      {submitError !== null && <ErrorState message={submitError} />}

      <div className="journal-actions">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save journal'}
        </Button>
        {/* Always in the DOM so the live region is present before it updates.
            'Saving…' is left to the button label — announcing both would say
            the same thing twice. */}
        <p className="journal-status" role="status">
          {saved && !submitting ? 'Saved.' : ''}
        </p>
      </div>
    </form>
  );
}
