/** Accept real screen-reader error presentation only when platform consumption, Orca output and actual speech-service delivery agree. */
import assert from 'node:assert/strict';

/** Require one presentation of this fixture's single failed action and a working synthesis pipeline. @param consumers Native service consumer JSON from the same anonymous run. @param orcaTranscript Actual Orca debug output. @param speechTranscript Same session's Speech Dispatcher log. @param message Validation error attempted exactly once by this fixture. @returns Count of actual Orca output records, or a failing acceptance assertion; no audible hardware playback claim is made. */
export function validateOrcaErrorPresentation(consumers: string, orcaTranscript: string, speechTranscript: string, message: string): { utterances: number; synthesisCompleted: true } {
  const state: unknown = JSON.parse(consumers);
  assert.ok(state && typeof state === 'object' && 'PlatformAPI' in state && state.PlatformAPI === true, 'No actual platform accessibility consumer');
  const outputs = orcaTranscript.split('\n').filter(line => line.includes(' - SPEECH OUTPUT:'));
  assert.ok(outputs.some(line => line.includes(message)), `Orca did not present validation error: ${message}`);
  assert.equal(outputs.filter(line => line.includes(message)).length, 1, 'Duplicate Orca validation-error announcements for one failed action');
  assert.ok(!orcaTranscript.includes('Cannot get speech server'), 'Orca speech server unavailable');
  assert.ok(speechTranscript.includes(':Orca:'), 'Speech service has no Orca client');
  const deliveries = [...speechTranscript.matchAll(/Command sent to output module: \|(<speak>[^\r\n]*<\/speak>)\|/g)];
  const completed = deliveries.some((delivery, index) => {
    // Remove only the observed word-index markers, without treating arbitrary XML as plain speech.
    const text = delivery[1].replace(/<mark name="(?:[0-9]+:[0-9]+|__spd_[0-9]+)"\/>/g, '');
    if (!text.includes(message)) return false;
    const segment = speechTranscript.slice(delivery.index, deliveries[index + 1]?.index ?? speechTranscript.length);
    const audio = segment.indexOf('Got audio:'), end = segment.indexOf('702 END'), stopped = segment.indexOf('703 STOP');
    return audio >= 0 && end > audio && (stopped < 0 || stopped > end);
  });
  assert.ok(completed, 'Missing completed speech synthesis of the validation error');
  return { utterances: outputs.length, synthesisCompleted: true };
}
