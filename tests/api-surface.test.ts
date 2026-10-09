import axios, { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { FirefliesSDK } from '../src/fireflies';

interface SentOperation {
  query: string;
  variables: Record<string, any>;
}

/**
 * Capture every GraphQL request the SDK sends and answer it with
 * `{ data: { <rootField>: <value> } }`, the root field taken from the operation.
 */
function installEcho(value: unknown = { ok: true }) {
  const sent: SentOperation[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const body = JSON.parse(config.data as string) as SentOperation;
    sent.push(body);
    const root = rootField(body.query);
    const response: AxiosResponse = {
      data: { data: { [root]: value } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      request: {}
    };
    return response;
  };
  const realCreate = axios.create.bind(axios);
  jest.spyOn(axios, 'create').mockImplementation(config => realCreate({ ...config, adapter }));
  return sent;
}

/** First field selected inside the operation's outer braces. */
function rootField(query: string): string {
  const match = /^\s*(?:query|mutation)\b[^{]*\{\s*(\w+)/.exec(query);
  if (!match) throw new Error(`Cannot find root field in:\n${query}`);
  return match[1];
}

/** `$name: Type` pairs declared in the operation header. */
function declaredVariables(query: string): Record<string, string> {
  const header = /^\s*(?:query|mutation)\s*\w*\s*\(([^)]*)\)/.exec(query);
  const declared: Record<string, string> = {};
  if (!header) return declared;
  for (const match of header[1].matchAll(/\$(\w+)\s*:\s*([\w[\]!]+)/g)) declared[match[1]] = match[2];
  return declared;
}

/** `$name` references in the operation body (after the header). */
function usedVariables(query: string): Set<string> {
  const bodyStart = query.indexOf('{');
  return new Set([...query.slice(bodyStart).matchAll(/\$(\w+)/g)].map(match => match[1]));
}

/** `argument: $variable` pairs inside the root field's argument list. */
function rootArguments(query: string): Record<string, string> {
  const root = rootField(query);
  const start = query.indexOf(root, query.indexOf('{'));
  const open = query.indexOf('(', start);
  const brace = query.indexOf('{', start);
  const args: Record<string, string> = {};
  if (open === -1 || open > brace) return args;
  const close = query.indexOf(')', open);
  for (const match of query.slice(open + 1, close).matchAll(/(\w+)\s*:\s*\$(\w+)/g)) args[match[1]] = match[2];
  return args;
}

type Call = (sdk: FirefliesSDK) => Promise<unknown>;

/**
 * Every public method, with the root field and the argument → GraphQL type
 * pairs it must send, spelled exactly as the public GraphQL schema prints them.
 *
 * List types carry the item `!`: the schema's list arguments are nullable lists
 * of NON-null items, `[X!]`, and GraphQL rejects a `[X]`
 * variable in that position at validation even when the variable is never sent.
 */
const SURFACE: Array<{ name: string; call: Call; root: string; args: Record<string, string>; respond?: unknown }> = [
  {
    name: 'getAIAppsOutputs',
    call: sdk => sdk.getAIAppsOutputs({ transcript_id: 't1', limit: 5 }, ['response']),
    root: 'apps',
    args: { app_id: 'String', transcript_id: 'String', skip: 'Float', limit: 'Float' },
    // Returns apps.outputs, one level below the root field.
    respond: { outputs: { marker: 42 } }
  },
  { name: 'getUser', call: sdk => sdk.getUser('u1', ['email']), root: 'user', args: { id: 'String' } },
  { name: 'getUsers', call: sdk => sdk.getUsers(['email']), root: 'users', args: {} },
  { name: 'getTranscript', call: sdk => sdk.getTranscript('t1', ['id']), root: 'transcript', args: { id: 'String!' } },
  {
    name: 'getTranscripts',
    call: sdk => sdk.getTranscripts({ fromDate: '2026-01-01T00:00:00.000Z', organizers: ['a@x.com'], scope: 'all', keyword: 'q' }),
    root: 'transcripts',
    args: {
      title: 'String',
      keyword: 'String',
      // The schema types `scope` as String; there is no TranscriptsQueryScope type.
      scope: 'String',
      fromDate: 'DateTime',
      toDate: 'DateTime',
      date: 'Float',
      limit: 'Int',
      skip: 'Int',
      host_email: 'String',
      organizer_email: 'String',
      participant_email: 'String',
      organizers: '[String!]',
      participants: '[String!]',
      channel_id: 'String',
      user_id: 'String',
      mine: 'Boolean'
    }
  },
  { name: 'getBite', call: sdk => sdk.getBite('b1', ['id']), root: 'bite', args: { id: 'ID!' } },
  {
    name: 'getBites',
    call: sdk => sdk.getBites({ mine: true, skip: 10 }, ['id']),
    root: 'bites',
    args: { mine: 'Boolean', transcript_id: 'ID', my_team: 'Boolean', limit: 'Int', skip: 'Int' }
  },
  {
    name: 'createBite',
    call: sdk => sdk.createBite({ transcript_id: 't1', start_time: 0, end_time: 5, privacies: ['team'] }),
    root: 'createBite',
    args: {
      transcript_id: 'ID!',
      name: 'String',
      start_time: 'Float!',
      end_time: 'Float!',
      media_type: 'String',
      privacies: '[BitePrivacy!]',
      summary: 'String'
    }
  },
  { name: 'setUserRole', call: sdk => sdk.setUserRole('u1', 'admin' as any), root: 'setUserRole', args: { user_id: 'String!', role: 'Role!' } },
  { name: 'deleteTranscript', call: sdk => sdk.deleteTranscript('t1'), root: 'deleteTranscript', args: { id: 'String!' } },
  { name: 'uploadAudio', call: sdk => sdk.uploadAudio({ url: 'https://x/a.mp3' }), root: 'uploadAudio', args: { input: 'AudioUploadInput!' } },
  {
    name: 'addToLiveMeeting',
    call: sdk => sdk.addToLiveMeeting({ meeting_link: 'https://meet.google.com/x', attendees: [{ displayName: 'A', email: 'a@x.com' }] }),
    root: 'addToLiveMeeting',
    args: {
      meeting_link: 'String!',
      title: 'String',
      meeting_password: 'String',
      duration: 'Int',
      language: 'String',
      attendees: '[AttendeeInput!]'
    }
  },
  {
    name: 'getActiveMeetings',
    call: sdk => sdk.getActiveMeetings({ states: ['active'] }),
    root: 'active_meetings',
    args: { input: 'GetActiveMeetingsInput' }
  },
  {
    name: 'updateMeetingTitle',
    call: sdk => sdk.updateMeetingTitle({ id: 't1', title: 'New' }),
    root: 'updateMeetingTitle',
    args: { input: 'UpdateMeetingTitleInput!' }
  },
  {
    name: 'updateMeetingPrivacy',
    call: sdk => sdk.updateMeetingPrivacy({ id: 't1', privacy: 'teammates' }),
    root: 'updateMeetingPrivacy',
    args: { input: 'UpdateMeetingPrivacyInput!' }
  },
  {
    name: 'updateMeetingChannel',
    call: sdk => sdk.updateMeetingChannel({ transcript_ids: ['t1'], channel_id: 'c1' }),
    root: 'updateMeetingChannel',
    args: { input: 'UpdateMeetingChannelInput!' }
  },
  {
    name: 'shareMeeting',
    call: sdk => sdk.shareMeeting({ meeting_id: 't1', emails: ['a@x.com'], expiry_days: 7 }),
    root: 'shareMeeting',
    args: { input: 'ShareMeetingInput!' }
  },
  {
    name: 'revokeSharedMeetingAccess',
    call: sdk => sdk.revokeSharedMeetingAccess({ meeting_id: 't1', email: 'a@x.com' }),
    root: 'revokeSharedMeetingAccess',
    args: { input: 'RevokeSharedMeetingAccessInput!' }
  },
  {
    name: 'createUploadUrl',
    call: sdk => sdk.createUploadUrl({ content_type: 'audio/mpeg', file_size: 1024 }),
    root: 'createUploadUrl',
    args: { input: 'CreateUploadUrlInput!' }
  },
  { name: 'confirmUpload', call: sdk => sdk.confirmUpload('m1'), root: 'confirmUpload', args: { input: 'ConfirmUploadInput!' } },
  {
    name: 'updateMeetingState',
    call: sdk => sdk.updateMeetingState({ meeting_id: 'm1', action: 'pause_recording' }),
    root: 'updateMeetingState',
    args: { input: 'UpdateMeetingStateInput!' }
  },
  {
    name: 'createLiveActionItem',
    call: sdk => sdk.createLiveActionItem({ meeting_id: 'm1', prompt: 'follow up' }),
    root: 'createLiveActionItem',
    args: { input: 'CreateLiveActionItemInput!' }
  },
  {
    name: 'createLiveSoundbite',
    call: sdk => sdk.createLiveSoundbite({ meeting_id: 'm1', prompt: 'demo' }),
    root: 'createLiveSoundbite',
    args: { input: 'CreateLiveSoundbiteInput!' }
  },
  { name: 'getLiveActionItems', call: sdk => sdk.getLiveActionItems('m1'), root: 'live_action_items', args: { meeting_id: 'ID!' } },
  {
    name: 'createAskFredThread',
    call: sdk => sdk.createAskFredThread({ query: 'What was decided?', transcript_id: 't1' }),
    root: 'createAskFredThread',
    args: { input: 'CreateAskFredThreadInput!' }
  },
  {
    name: 'continueAskFredThread',
    call: sdk => sdk.continueAskFredThread({ thread_id: 'th1', query: 'And then?' }),
    root: 'continueAskFredThread',
    args: { input: 'ContinueAskFredThreadInput!' }
  },
  { name: 'getAskFredThreads', call: sdk => sdk.getAskFredThreads({ transcript_id: 't1' }), root: 'askfred_threads', args: { transcript_id: 'String' } },
  { name: 'getAskFredThread', call: sdk => sdk.getAskFredThread('th1'), root: 'askfred_thread', args: { id: 'String!' } },
  { name: 'deleteAskFredThread', call: sdk => sdk.deleteAskFredThread('th1'), root: 'deleteAskFredThread', args: { id: 'String!' } },
  { name: 'getChannels', call: sdk => sdk.getChannels(), root: 'channels', args: {} },
  { name: 'getChannel', call: sdk => sdk.getChannel('c1'), root: 'channel', args: { id: 'ID!' } },
  { name: 'getContacts', call: sdk => sdk.getContacts(), root: 'contacts', args: {} },
  { name: 'getUserGroups', call: sdk => sdk.getUserGroups({ mine: true }), root: 'user_groups', args: { mine: 'Boolean' } },
  {
    name: 'addUserToUserGroup',
    call: sdk => sdk.addUserToUserGroup({ group_id: 'g1', user_email: 'a@x.com' }),
    root: 'addUserToUserGroup',
    args: { group_id: 'String!', user_email: 'String!' }
  },
  {
    name: 'removeUserFromUserGroup',
    call: sdk => sdk.removeUserFromUserGroup({ group_id: 'g1', user_email: 'a@x.com' }),
    root: 'removeUserFromUserGroup',
    args: { group_id: 'String!', user_email: 'String!' }
  },
  {
    name: 'getAnalytics',
    call: sdk => sdk.getAnalytics({ start_time: '2026-01-01T00:00:00Z' }),
    root: 'analytics',
    args: { start_time: 'String', end_time: 'String' }
  },
  {
    name: 'getAuditEvents',
    call: sdk => sdk.getAuditEvents({ filters: { category: 'MEETING_OPERATIONS' }, limit: 10 }),
    root: 'auditEvents',
    args: { limit: 'Int', cursor: 'String', filters: 'AuditEventFiltersInput!' }
  },
  {
    name: 'getRuleExecutionsByMeeting',
    call: sdk => sdk.getRuleExecutionsByMeeting({ filters: { is_test: false } }),
    root: 'rule_executions_by_meeting',
    args: { limit: 'Int', cursor: 'String', logs_per_meeting: 'Int', filters: 'RuleExecutionFiltersInput' }
  }
];

describe('public API surface', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(SURFACE)('$name sends $root with the schema argument names and types', async ({ call, root, args }) => {
    const sent = installEcho();
    await call(new FirefliesSDK({ apiKey: 'key' }));

    expect(sent).toHaveLength(1);
    const { query } = sent[0];
    expect(rootField(query)).toBe(root);

    const declared = declaredVariables(query);
    const actual: Record<string, string> = {};
    for (const [argument, variable] of Object.entries(rootArguments(query))) actual[argument] = declared[variable];
    expect(actual).toEqual(args);
  });

  it.each(SURFACE)('$name declares every variable it uses and uses every variable it declares', async ({ call }) => {
    const sent = installEcho();
    await call(new FirefliesSDK({ apiKey: 'key' }));

    const { query } = sent[0];
    expect(new Set(Object.keys(declaredVariables(query)))).toEqual(usedVariables(query));
  });

  it.each(SURFACE)('$name returns the root field unwrapped', async ({ call, respond }) => {
    installEcho(respond ?? { marker: 42 });
    await expect(call(new FirefliesSDK({ apiKey: 'key' }))).resolves.toEqual({ marker: 42 });
  });

  it.each(SURFACE)('$name declares every list variable with non-null items', async ({ call }) => {
    const sent = installEcho();
    await call(new FirefliesSDK({ apiKey: 'key' }));

    const lists = Object.entries(declaredVariables(sent[0].query)).filter(([, type]) => type.startsWith('['));
    for (const [variable, type] of lists) {
      expect({ variable, type }).toEqual({ variable, type: expect.stringMatching(/^\[\w+!\]!?$/) });
    }
  });

  it('has a test entry for every public instance method', () => {
    const helpers = new Set(['constructor', 'findExternalParticipantQuestions', 'getMeetingVideos', 'getTranscriptSummary', 'getCurrentUser']);
    const methods = Object.getOwnPropertyNames(FirefliesSDK.prototype).filter(
      name => !helpers.has(name) && typeof (FirefliesSDK.prototype as any)[name] === 'function' && !name.startsWith('record') && !name.startsWith('execute')
    );
    expect(methods.sort()).toEqual(SURFACE.map(entry => entry.name).sort());
  });

  it('maps snake_case transcript filters onto the declared variables', async () => {
    const sent = installEcho([]);
    await new FirefliesSDK({ apiKey: 'key' }).getTranscripts({
      fromDate: '2026-01-01T00:00:00.000Z',
      toDate: '2026-02-01T00:00:00.000Z',
      organizer_email: 'o@x.com',
      channel_id: 'c1',
      participants: ['p@x.com']
    });
    expect(sent[0].variables).toMatchObject({
      fromDate: '2026-01-01T00:00:00.000Z',
      toDate: '2026-02-01T00:00:00.000Z',
      organizerEmail: 'o@x.com',
      channelId: 'c1',
      participants: ['p@x.com']
    });
  });

  it('wraps input-object arguments as { input } and passes them through unchanged', async () => {
    const sent = installEcho();
    const input = { meeting_id: 't1', emails: ['a@x.com'], expiry_days: 14 as const, share_type: 'email' as const };
    await new FirefliesSDK({ apiKey: 'key' }).shareMeeting(input);
    expect(sent[0].variables).toEqual({ input });
  });

  it('selects sensible default fields when none are given, and the caller\'s otherwise', async () => {
    const sent = installEcho([]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });
    await sdk.getChannels();
    await sdk.getChannels(['id']);
    expect(sent[0].query).toContain('members { user_id email name }');
    expect(sent[1].query).not.toContain('members');
    expect(sent[1].query.replace(/\s+/g, ' ')).toContain('channels { id }');
  });
});
