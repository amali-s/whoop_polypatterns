import {
  JOURNAL_QUESTIONS,
  type JournalAnswers,
  type JournalQuestionKey,
} from '../../api/_lib/journal-types';
import './components.css';

/**
 * READ-ONLY view of a day's saved journal entry (2026-08-01) — the "logged
 * today" state of the bento journal tile. It renders the same eight questions
 * `JournalForm` asks, in the same `JOURNAL_QUESTIONS` order, with no editable
 * controls at all.
 *
 * NULL DISCIPLINE, unchanged and load-bearing: `null` is NOT ANSWERED and is
 * shown as a muted "Not answered" — never "No", never "0", never an omitted
 * row. `hydrated: false` and `caffeine_servings: 0` are real answers and read
 * as "No" and "0". Dropping unanswered rows entirely was rejected: a reader
 * would then have no way to tell "I didn't log cramps" from "there is no
 * cramps question", which is exactly the distinction the whole schema exists
 * to preserve (see journal-types.ts's header, and src/lib/cycle.ts for what a
 * fabricated `period: 'no'` would do to cycle detection).
 *
 * A `<dl>` rather than a table: this is one entity's field/value pairs, not a
 * grid of rows and columns, and a definition list needs no header semantics.
 */
export interface JournalSummaryProps {
  /** The calendar day these answers belong to, ISO 'YYYY-MM-DD'. */
  day: string;
  /** The saved entry. Any field may be null — see the null-discipline note. */
  answers: JournalAnswers;
}

const NOT_ANSWERED = 'Not answered';

/** Sentence-case a locked vocabulary value ('moderate' → 'Moderate'). */
function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

/**
 * One answer as display text, `null` meaning "not answered" everywhere. The
 * exhaustive switch means a ninth question added to JOURNAL_QUESTIONS is a
 * compile error here, not a silently missing row — the same guard
 * `JournalForm.renderQuestion` uses.
 */
function answerText(key: JournalQuestionKey, answers: JournalAnswers): string | null {
  switch (key) {
    case 'hydrated':
    case 'afternoon_snack':
    case 'traveled': {
      const value = answers[key];
      // `!= null`, not truthiness: an answered `false` must read "No".
      return value == null ? null : value ? 'Yes' : 'No';
    }
    case 'period':
      return answers.period == null ? null : capitalize(answers.period);
    case 'cramps':
      return answers.cramps == null ? null : capitalize(answers.cramps);
    case 'discharge':
      return answers.discharge == null ? null : capitalize(answers.discharge);
    case 'caffeine_servings':
      // String(0) is '0' — an answered "none", distinct from the null above.
      return answers.caffeine_servings == null ? null : String(answers.caffeine_servings);
    case 'alcohol_drinks':
      return answers.alcohol_drinks == null ? null : String(answers.alcohol_drinks);
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

/**
 * 'YYYY-MM-DD' → a readable date. Parsed AND formatted in UTC, matching
 * JournalForm's own formatDay: `new Date('2026-07-30')` is midnight UTC, so
 * formatting it in a behind-UTC local zone would render the day BEFORE the one
 * being shown.
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

export function JournalSummary({ day, answers }: JournalSummaryProps) {
  const dayLabel = formatDay(day);
  const notes = answers.notes?.trim();
  return (
    <div className="journal-summary">
      <p className="journal-day">
        <time dateTime={day}>{dayLabel}</time>
      </p>
      <dl className="journal-summary-list">
        {JOURNAL_QUESTIONS.map((question) => {
          const text = answerText(question.key, answers);
          return (
            <div key={question.key} className="journal-summary-row">
              <dt>{question.label}</dt>
              <dd className={text === null ? 'journal-summary-unanswered' : undefined}>
                {text ?? NOT_ANSWERED}
              </dd>
            </div>
          );
        })}
        {/* Notes is the schema's free-text field, not one of the eight
            questions, so its label is local — the JournalForm precedent. */}
        <div className="journal-summary-row">
          <dt>Notes</dt>
          <dd
            className={
              notes ? 'journal-summary-notes' : 'journal-summary-notes journal-summary-unanswered'
            }
          >
            {notes || NOT_ANSWERED}
          </dd>
        </div>
      </dl>
    </div>
  );
}
