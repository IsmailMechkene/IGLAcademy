import { useState } from 'react';
import { Check, Flame } from 'lucide-react';
import type { StudyStats } from '../../types';
import styles from './StudyActivity.module.css';

const minutes = (seconds: number) => Math.round(seconds / 60);

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today's goal, the streak and the last seven days of study. */
export default function StudyActivity({ stats }: { stats: StudyStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const todayMin = minutes(stats.today.studiedSeconds);
  const goalMin = minutes(stats.today.goalSeconds);
  const goalMet = goalMin > 0 && todayMin >= goalMin;
  const fill = goalMin > 0 ? Math.min(1, stats.today.studiedSeconds / stats.today.goalSeconds) : 0;

  // One scale for the week: the larger of the busiest day and the goal, so
  // the goal line always sits inside the plot.
  const scaleMax = Math.max(stats.today.goalSeconds, ...stats.last7.map((d) => d.studiedSeconds), 60);
  const goalPct = (stats.today.goalSeconds / scaleMax) * 100;

  const extras = [
    stats.today.lessonsCompleted > 0 && `${stats.today.lessonsCompleted} lesson${stats.today.lessonsCompleted === 1 ? '' : 's'} finished`,
    stats.today.questionsAnswered > 0 && `${stats.today.questionsAnswered} question${stats.today.questionsAnswered === 1 ? '' : 's'} answered`,
    stats.today.cardsReviewed > 0 && `${stats.today.cardsReviewed} card${stats.today.cardsReviewed === 1 ? '' : 's'} reviewed`,
  ].filter(Boolean) as string[];

  return (
    <section className={`card ${styles.card}`} aria-label="Your study">
      {/* ---- today's goal ---- */}
      <div className={styles.goal}>
        <div className={styles.label}>Today</div>
        <div className={styles.goalValue}>
          {todayMin}
          <span className={styles.goalOf}> / {goalMin} min</span>
        </div>
        <div
          className={styles.meter}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={goalMin}
          aria-valuenow={Math.min(todayMin, goalMin)}
          aria-label="Daily goal"
        >
          <span className={goalMet ? styles.meterDone : ''} style={{ width: `${fill * 100}%` }} />
        </div>
        <div className={styles.caption}>
          {goalMet ? (
            <span className={styles.met}><Check size={13} strokeWidth={3} /> Goal reached</span>
          ) : (
            `${Math.max(0, goalMin - todayMin)} min to your daily goal`
          )}
        </div>
        {extras.length > 0 && <div className={styles.extras}>{extras.join(' · ')}</div>}
      </div>

      {/* ---- streak ---- */}
      <div className={styles.streak}>
        <div className={styles.label}>Streak</div>
        <div className={styles.streakValue}>
          <Flame size={24} className={stats.currentStreak > 0 ? styles.flameOn : styles.flameOff} aria-hidden="true" />
          {stats.currentStreak}
          <span className={styles.streakUnit}>day{stats.currentStreak === 1 ? '' : 's'}</span>
        </div>
        <div className={styles.caption}>
          {stats.currentStreak === 0
            ? 'Study today to start one'
            : stats.activeToday
              ? 'Studied today — keep it going'
              : 'Study today to keep it alive'}
        </div>
        <div className={styles.extras}>Best: {stats.bestStreak} day{stats.bestStreak === 1 ? '' : 's'}</div>
      </div>

      {/* ---- last 7 days ---- */}
      <div className={styles.week}>
        <div className={styles.weekHeader}>
          <span className={styles.label}>Last 7 days</span>
          <span className={styles.caption}>
            {minutes(stats.last7.reduce((n, d) => n + d.studiedSeconds, 0))} min studied
          </span>
        </div>
        <div className={styles.plot} aria-hidden="true">
          <div className={styles.goalLine} style={{ bottom: `${goalPct}%` }}>
            <span>goal</span>
          </div>
          {stats.last7.map((d, i) => {
            const isToday = i === stats.last7.length - 1;
            const h = (d.studiedSeconds / scaleMax) * 100;
            return (
              <div
                key={d.day}
                className={styles.slot}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {isToday && d.studiedSeconds > 0 && (
                  <span className={styles.capLabel} style={{ bottom: `calc(${h}% + 4px)` }}>
                    {minutes(d.studiedSeconds)}m
                  </span>
                )}
                {d.studiedSeconds > 0 && (
                  <span
                    className={`${styles.bar} ${hover === i ? styles.barHover : ''}`}
                    style={{ height: `max(${h}%, 3px)` }}
                  />
                )}
                {hover === i && (
                  <span className={styles.tooltip} style={{ bottom: `calc(${Math.max(h, 0)}% + 8px)` }}>
                    <strong>
                      {dayDate(d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </strong>
                    {minutes(d.studiedSeconds)} min{d.active ? '' : d.studiedSeconds > 0 ? ' · under a minute' : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className={styles.axis} aria-hidden="true">
          {stats.last7.map((d, i) => (
            <span key={d.day} className={i === stats.last7.length - 1 ? styles.axisToday : ''}>
              {i === stats.last7.length - 1 ? 'Today' : dayDate(d.day).toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
          ))}
        </div>
        {/* The chart's table twin, for screen readers. */}
        <table className={styles.srOnly}>
          <caption>Minutes studied in the last 7 days (goal {goalMin} min)</caption>
          <tbody>
            {stats.last7.map((d) => (
              <tr key={d.day}>
                <th scope="row">{dayDate(d.day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</th>
                <td>{minutes(d.studiedSeconds)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
