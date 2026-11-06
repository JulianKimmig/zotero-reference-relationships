/** Screen-reader acceptance requires an actual Orca utterance and real speech-service delivery, rather than matching AT-SPI diagnostics. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOrcaErrorPresentation } from '../scripts/sync/orca-evidence.mts';

const message = 'Choose a target reference';
const consumers = '{"XPCOM":true,"PlatformAPI":true}';
const orca = `12:00:00 - SPEECH OUTPUT: '${message}' {'established': False}`;
const speech = `SET self CLIENT_NAME unknown:Orca:default\nCommand sent to output module: |<speak>${message}</speak>|\nGot audio: 1024 bytes\n702 END`;

test('actual platform consumption, Orca speech text and real synthesis evidence pass together', () => {
  assert.equal(validateOrcaErrorPresentation(consumers, orca, speech, message).utterances, 1);
});

test('AT-SPI error text without an Orca utterance fails the screen-reader gate', () => {
  assert.throws(() => validateOrcaErrorPresentation(consumers, `AXText: ${message}`, speech, message), /Orca did not present/i);
});

test('a native-only accessible alert cannot substitute for actual platform consumption', () => {
  assert.throws(() => validateOrcaErrorPresentation('{"XPCOM":true,"PlatformAPI":false}', orca, speech, message), /platform/i);
});

test('speech text without synthesis, the expected payload or an Orca client fails separately', () => {
  for (const log of [speech.replace('Got audio:', 'No audio:'), speech.replace(message, 'Different text'), speech.replace(':Orca:', ':other:')]) {
    assert.throws(() => validateOrcaErrorPresentation(consumers, orca, log, message), /speech|synthesis|Orca/i);
  }
});

test('an unavailable speech server remains a failure even if a transcript contains expected text', () => {
  assert.throws(() => validateOrcaErrorPresentation(consumers, `${orca}\nCannot get speech server`, speech, message), /speech server/i);
});

test('real Orca word-index SSML preserves the spoken validation phrase', () => {
  const marked = '<mark name="0:6"/>Choose <mark name="7:8"/>a <mark name="9:15"/>target <mark name="16:25"/>reference<mark name="__spd_0"/>';
  assert.doesNotThrow(() => validateOrcaErrorPresentation(consumers, orca, speech.replace(message, marked), message));
});

test('queued text or audio from a later utterance cannot prove synthesis of the validation error', () => {
  const unrelated = speech.replace('Command sent to output module:', 'Queueing message:');
  const next = speech.replace(message, 'Another control');
  assert.throws(() => validateOrcaErrorPresentation(consumers, orca, `${unrelated}\n${next}`, message), /speech|synthesis/i);
  const canceled = speech.replace('Got audio: 1024 bytes\n702 END', '703 STOP');
  assert.throws(() => validateOrcaErrorPresentation(consumers, orca, `${canceled}\n${next}`, message), /speech|synthesis/i);
});

test('one failed action must not produce duplicate screen-reader announcements', () => {
  assert.throws(() => validateOrcaErrorPresentation(consumers, `${orca}\n${orca}`, speech, message), /duplicate/i);
});
