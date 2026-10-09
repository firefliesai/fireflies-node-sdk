import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { generateGraphQLFilter, MeetingsHelper, BatchProcessResult } from './helper.js';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RETRY_WAIT_MS,
  FirefliesRateLimitError,
  RateLimitRetryOptions,
  RateLimitState,
  findTooManyRequestsError,
  mergeRateLimitState,
  parseRateLimitHeaders,
  resolveRetryDelayMs,
  sleep
} from './rate-limit';
import {
  FirefliesConfig,
  AIAppOutput,
  AIAppsQueryParams,
  UserData,
  TranscriptData,
  TranscriptsQueryParams,
  BiteData,
  BitesQueryParams,
  UserRole,
  SetUserRoleResponse,
  DeleteTranscriptResponse,
  AudioUploadInput,
  AudioUploadResponse,
  CreateBiteInput,
  CreateBiteResponse,
  AddToLiveMeetingInput,
  AddToLiveMeetingResponse,
  ActiveMeeting,
  ActiveMeetingsQueryParams,
  AnalyticsData,
  AnalyticsQueryParams,
  AskFredResponse,
  AskFredThread,
  AskFredThreadSummary,
  AuditEventsPage,
  AuditEventsQueryParams,
  Channel,
  ConfirmUploadResponse,
  Contact,
  ContinueAskFredThreadInput,
  CreateAskFredThreadInput,
  CreateUploadUrlInput,
  LiveActionItem,
  LiveActionResult,
  LivePromptInput,
  RevokeSharedMeetingAccessInput,
  RevokeSharedMeetingAccessResponse,
  RuleExecutionsByMeetingPage,
  RuleExecutionsQueryParams,
  ShareMeetingInput,
  ShareMeetingResponse,
  UpdateMeetingChannelInput,
  UpdateMeetingPrivacyInput,
  UpdateMeetingStateInput,
  UpdateMeetingStateResult,
  UpdateMeetingTitleInput,
  UploadUrlResponse,
  UserGroup,
  UserGroupMembershipInput
} from './types';

/** The fields to select: the caller's, or a sensible default when none are given. */
function selection(fields: string[] | undefined, defaults: string[]): string {
  return generateGraphQLFilter(fields && fields.length > 0 ? fields : defaults);
}

const DEFAULT_FIELDS = {
  transcript: ['id', 'title', 'privacy'],
  activeMeeting: ['id', 'title', 'organizer_email', 'meeting_link', 'start_time', 'end_time', 'privacy', 'state'],
  channel: ['id', 'title', 'is_private', 'created_by', 'created_at', 'updated_at', 'members { user_id email name }'],
  contact: ['email', 'name', 'picture', 'last_meeting_date'],
  userGroup: ['id', 'name', 'handle', 'members { user_id first_name last_name email }'],
  askFredThreadSummary: ['id', 'title', 'transcript_id', 'user_id', 'created_at'],
  askFredMessage: ['id', 'thread_id', 'query', 'answer', 'suggested_queries', 'status', 'created_at'],
  analytics: [
    'team { meeting { count duration average_count average_duration } conversation { total_meetings_count teammates_count average_talk_listen_ratio } }'
  ],
  auditEvents: [
    'events { id time category action severity status message actor { user_id email full_name ip_address } resource { type id } metadata }',
    'has_more',
    'next_cursor'
  ],
  ruleExecutions: [
    'meetings { meeting_id meeting { id title organizer_email } executions { extension_id extension_title stopped_at user_name share { group_ids } channel { channel_id } meeting_privacy { privacy } } }',
    'has_more',
    'next_cursor'
  ]
};

export interface AIFilter {
  task: string;
  pricing: string;
  metric: string;
  question: string;
  date_and_time: string;
  text_cleanup: string;
  sentiment: string;
}

export interface MeetingInfo {
  fred_joined: boolean;
  silent_meeting: boolean;
  summary_status: string;
}

export interface Sentence {
  index: number;
  speaker_name: string;
  speaker_id: string;
  meeting_info: MeetingInfo;
  text: string;
  raw_text: string;
  start_time: number;
  end_time: number;
  ai_filters: AIFilter;
}

export interface Speaker {
  id: string;
  name: string;
}

export interface MeetingAttendee {
  displayName: string;
  email: string;
  phoneNumber?: string;
  name: string;
  location?: string;
}

export interface Summary {
  keywords: string[];
  action_items: string[];
  outline: string[];
  shorthand_bullet: string;
  overview: string;
  bullet_gist: string;
  gist: string;
  short_summary: string;
  short_overview: string;
  meeting_type: string;
  topics_discussed: string[];
  transcript_chapters: string[];
}

export interface BiteCaption {
  end_time: number;
  index: number;
  speaker_id: string;
  speaker_name: string;
  start_time: number;
  text: string;
}

export interface BiteSource {
  src: string;
  type: string;
}

export interface BiteCreatedFrom {
  description: string;
  duration: number;
  id: string;
  name: string;
  type: string;
}

export interface BiteUser {
  first_name: string;
  last_name: string;
  picture: string;
  name: string;
  id: string;
}

interface GraphQLResponseBody<T> {
  data?: T;
  errors?: Array<{ message?: string; code?: string; extensions?: Record<string, any> }>;
  message?: string;
}

interface RateLimitedAttempt {
  state: RateLimitState | null;
  error: ReturnType<typeof findTooManyRequestsError>;
  message?: string;
}

export class FirefliesSDK {
  private client: AxiosInstance;
  private static DEFAULT_BASE_URL = 'https://api.fireflies.ai/graphql';
  private readonly retryOptions: Required<Pick<RateLimitRetryOptions, 'maxRetries' | 'maxRetryWaitMs'>> &
    Pick<RateLimitRetryOptions, 'onRateLimited'>;
  private lastRateLimit: RateLimitState | null = null;

  constructor(config: FirefliesConfig) {
    this.client = axios.create({
      baseURL: config.baseURL || FirefliesSDK.DEFAULT_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      }
    });
    this.retryOptions = {
      maxRetries: Math.max(0, config.rateLimit?.maxRetries ?? DEFAULT_MAX_RETRIES),
      maxRetryWaitMs: Math.max(0, config.rateLimit?.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS),
      onRateLimited: config.rateLimit?.onRateLimited
    };
  }

  /**
   * Rate-limit state parsed from the most recent API response (`X-RateLimit-*`
   * and `Retry-After` headers), or `null` before the first response / when the
   * server sent none. Updated on every response, including rejected ones.
   * See https://docs.fireflies.ai/fundamentals/limits
   */
  get rateLimit(): RateLimitState | null {
    return this.lastRateLimit;
  }

  private recordRateLimit(headers: unknown): RateLimitState | null {
    const parsed = parseRateLimitHeaders(headers as Record<string, unknown>);
    if (!parsed) return null;
    // Concurrent responses arrive in any order: never let a stale, higher
    // count overwrite a lower one from the same window.
    this.lastRateLimit = mergeRateLimitState(this.lastRateLimit, parsed);
    return this.lastRateLimit;
  }

  private async executeGraphQL<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    const { maxRetries, maxRetryWaitMs, onRateLimited } = this.retryOptions;

    for (let attempt = 1; ; attempt++) {
      let rateLimited: RateLimitedAttempt | null = null;

      try {
        const response: AxiosResponse<GraphQLResponseBody<T>> = await this.client.post('', { query, variables });
        const state = this.recordRateLimit(response.headers);
        const body = response.data;
        const tooMany = findTooManyRequestsError(body?.errors);

        if (tooMany) {
          // The API can also report a rejection as a GraphQL error on a 200.
          rateLimited = { state, error: tooMany, message: tooMany.message };
        } else {
          if ((body?.data === undefined || body?.data === null) && body?.errors?.length) {
            throw new Error(`Fireflies API Error: ${body.errors[0]?.message || 'Unknown GraphQL error'}`);
          }
          // GraphQL responses always have a data property containing the actual response
          return body.data as T;
        }
      } catch (error) {
        if (!axios.isAxiosError(error)) throw error;

        const state = error.response ? this.recordRateLimit(error.response.headers) : null;
        const body = error.response?.data as GraphQLResponseBody<T> | undefined;
        const tooMany = findTooManyRequestsError(body?.errors);
        if (error.response?.status === 429 || tooMany) {
          rateLimited = { state, error: tooMany, message: tooMany?.message ?? body?.message };
        } else {
          console.log(error.response?.data)
          throw new Error(`Fireflies API Error: ${error.response?.data?.message || error.message}`);
        }
      }

      const waitMs = resolveRetryDelayMs(rateLimited.state, rateLimited.error);
      // Never retry before the server's window reopens: retrying early extends the block.
      if (attempt > maxRetries || waitMs > maxRetryWaitMs) {
        throw new FirefliesRateLimitError({
          retryAfterMs: waitMs,
          rateLimit: rateLimited.state,
          attempts: attempt,
          serverMessage: rateLimited.message
        });
      }
      onRateLimited?.({ attempt, waitMs, rateLimit: rateLimited.state });
      await sleep(waitMs);
    }
  }

  async getAIAppsOutputs(params: AIAppsQueryParams = {}, filter: string[]): Promise<AIAppOutput[]> {
    const query = `
      query GetAIAppsOutputs($app_id: String, $transcript_id: String, $skip: Float, $limit: Float) {
        apps(app_id: $app_id, transcript_id: $transcript_id, skip: $skip, limit: $limit) {
          outputs {
           ${generateGraphQLFilter(filter)}
          }
        }
      }
    `;

    const response = await this.executeGraphQL<{ apps: { outputs: AIAppOutput[] } }>(query, params);
    return response.apps.outputs;
  }

  async getUser(userId: string, filter: string[] = []): Promise<UserData> {
    const query = `
      query User($userId: String) {
        user(id: $userId) {
          ${generateGraphQLFilter(filter)}
        }
      }
    `;

    const response = await this.executeGraphQL<{ user: UserData }>(query, userId ? { userId } : {});
    return response.user;
  }

  async getUsers(filter: string[] = []): Promise<UserData> {
    const query = `
      query Users {
        users {
          ${generateGraphQLFilter(filter)}
        }
      }
    `;

    const response = await this.executeGraphQL<{ users: UserData }>(query, {});
    return response.users;
  }

  async getCurrentUser(filter: string[] = []): Promise<UserData> {
    return this.getUser('', filter);
  }

  async getTranscript(transcriptId: string, filter: string[] = []): Promise<TranscriptData> {
    const query = `
      query Transcript($transcriptId: String!) {
        transcript(id: $transcriptId) {
          ${generateGraphQLFilter(filter)}
        }
      }
    `;

    const response = await this.executeGraphQL<{ transcript: TranscriptData }>(query, { transcriptId });
    return response.transcript;
  }

  async getTranscripts(params: TranscriptsQueryParams = {}, filter: string[] = []): Promise<TranscriptData[]> {
    const query = `
      query Transcripts(
        $title: String
        $keyword: String
        $scope: TranscriptsQueryScope
        $fromDate: DateTime
        $toDate: DateTime
        $date: Float
        $limit: Int
        $skip: Int
        $hostEmail: String
        $organizerEmail: String
        $participantEmail: String
        $organizers: [String]
        $participants: [String]
        $channelId: String
        $userId: String
        $mine: Boolean
      ) {
        transcripts(
          title: $title
          keyword: $keyword
          scope: $scope
          fromDate: $fromDate
          toDate: $toDate
          date: $date
          limit: $limit
          skip: $skip
          host_email: $hostEmail
          organizer_email: $organizerEmail
          participant_email: $participantEmail
          organizers: $organizers
          participants: $participants
          channel_id: $channelId
          user_id: $userId
          mine: $mine
        ) {
          ${selection(filter, ['id', 'title', 'date'])}
        }
      }
    `;

    const response = await this.executeGraphQL<{ transcripts: TranscriptData[] }>(query, {
      title: params.title,
      keyword: params.keyword,
      scope: params.scope,
      fromDate: params.fromDate,
      toDate: params.toDate,
      date: params.date,
      limit: params.limit,
      skip: params.skip,
      hostEmail: params.host_email,
      organizerEmail: params.organizer_email,
      participantEmail: params.participant_email,
      organizers: params.organizers,
      participants: params.participants,
      channelId: params.channel_id,
      userId: params.user_id,
      mine: params.mine
    });
    return response.transcripts;
  }

  async getBite(biteId: string, filter: string[] = []): Promise<BiteData> {
    const query = `
      query Bite($biteId: ID!) {
        bite(id: $biteId) {
            ${generateGraphQLFilter(filter)}
        }
      }
    `;

    const response = await this.executeGraphQL<{ bite: BiteData }>(query, { biteId });
    return response.bite;
  }

  async getBites(params: BitesQueryParams = {}, filter: string[] = []): Promise<BiteData[]> {
    const query = `
      query Bites($mine: Boolean, $transcript_id: ID, $my_team: Boolean, $limit: Int, $skip: Int) {
        bites(mine: $mine, transcript_id: $transcript_id, my_team: $my_team, limit: $limit, skip: $skip) {
          ${generateGraphQLFilter(filter)}
        }
      }
    `;

    const response = await this.executeGraphQL<{ bites: BiteData[] }>(query, params);
    return response.bites;
  }

  async setUserRole(userId: string, role: UserRole): Promise<SetUserRoleResponse> {
    const query = `
      mutation SetUserRole($userId: String!, $role: Role!) {
        setUserRole(user_id: $userId, role: $role) {
          name
          is_admin
        }
      }
    `;

    const response = await this.executeGraphQL<{ setUserRole: SetUserRoleResponse }>(query, {
      userId,
      role
    });
    return response.setUserRole;
  }

  async deleteTranscript(transcriptId: string): Promise<DeleteTranscriptResponse> {
    const query = `
      mutation DeleteTranscript($transcriptId: String!) {
        deleteTranscript(id: $transcriptId) {
          title
          date
          duration
          organizer_email
        }
      }
    `;

    const response = await this.executeGraphQL<{ deleteTranscript: DeleteTranscriptResponse }>(query, { transcriptId });
    return response.deleteTranscript;
  }

  async uploadAudio(input: AudioUploadInput): Promise<AudioUploadResponse> {
    const query = `
      mutation UploadAudio($input: AudioUploadInput!) {
        uploadAudio(input: $input) {
          success
          title
          message
        }
      }
    `;

    const response = await this.executeGraphQL<{ uploadAudio: AudioUploadResponse }>(query, { input });
    return response.uploadAudio;
  }

  // The schema spells createBite's transcript argument `transcript_Id`
  // (capital I; CreateBiteDto in public-api-ff), unlike every other operation.
  async createBite(input: CreateBiteInput): Promise<CreateBiteResponse> {
    const query = `
      mutation CreateBite(
        $transcript_id: ID!,
        $name: String,
        $start_time: Float!,
        $end_time: Float!,
        $media_type: String,
        $privacies: [BitePrivacy],
        $summary: String
      ) {
        createBite(
          transcript_Id: $transcript_id,
          name: $name,
          start_time: $start_time,
          end_time: $end_time,
          media_type: $media_type,
          privacies: $privacies,
          summary: $summary
        ) {
          status
          name
          id
        }
      }
    `;

    const response = await this.executeGraphQL<{ createBite: CreateBiteResponse }>(query, input);
    return response.createBite;
  }

  async addToLiveMeeting(input: AddToLiveMeetingInput): Promise<AddToLiveMeetingResponse> {
    const query = `
      mutation AddToLiveMeeting(
        $meeting_link: String!
        $title: String
        $meeting_password: String
        $duration: Int
        $language: String
        $attendees: [AttendeeInput]
      ) {
        addToLiveMeeting(
          meeting_link: $meeting_link
          title: $title
          meeting_password: $meeting_password
          duration: $duration
          language: $language
          attendees: $attendees
        ) {
          success
        }
      }
    `;

    const response = await this.executeGraphQL<{ addToLiveMeeting: AddToLiveMeetingResponse }>(query, input);
    return response.addToLiveMeeting;
  }

  // ---------------------------------------------------------------------------
  // Meetings: live state, title, privacy, channels, sharing
  // ---------------------------------------------------------------------------

  /** Meetings the notetaker is in right now. https://docs.fireflies.ai/graphql-api/query/active-meetings */
  async getActiveMeetings(params: ActiveMeetingsQueryParams = {}, filter: string[] = []): Promise<ActiveMeeting[]> {
    const query = `
      query ActiveMeetings($input: GetActiveMeetingsInput) {
        active_meetings(input: $input) {
          ${selection(filter, DEFAULT_FIELDS.activeMeeting)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ active_meetings: ActiveMeeting[] }>(query, { input: params });
    return response.active_meetings;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/update-meeting-title */
  async updateMeetingTitle(input: UpdateMeetingTitleInput, filter: string[] = []): Promise<TranscriptData> {
    const query = `
      mutation UpdateMeetingTitle($input: UpdateMeetingTitleInput!) {
        updateMeetingTitle(input: $input) {
          ${selection(filter, DEFAULT_FIELDS.transcript)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ updateMeetingTitle: TranscriptData }>(query, { input });
    return response.updateMeetingTitle;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/update-meeting-privacy */
  async updateMeetingPrivacy(input: UpdateMeetingPrivacyInput, filter: string[] = []): Promise<TranscriptData> {
    const query = `
      mutation UpdateMeetingPrivacy($input: UpdateMeetingPrivacyInput!) {
        updateMeetingPrivacy(input: $input) {
          ${selection(filter, DEFAULT_FIELDS.transcript)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ updateMeetingPrivacy: TranscriptData }>(query, { input });
    return response.updateMeetingPrivacy;
  }

  /** Move up to 5 transcripts into a channel. https://docs.fireflies.ai/graphql-api/mutation/update-meeting-channel */
  async updateMeetingChannel(input: UpdateMeetingChannelInput, filter: string[] = []): Promise<TranscriptData[]> {
    const query = `
      mutation UpdateMeetingChannel($input: UpdateMeetingChannelInput!) {
        updateMeetingChannel(input: $input) {
          ${selection(filter, ['id', 'title', 'channels { id }'])}
        }
      }
    `;
    const response = await this.executeGraphQL<{ updateMeetingChannel: TranscriptData[] }>(query, { input });
    return response.updateMeetingChannel;
  }

  /** Share a meeting with up to 50 emails. https://docs.fireflies.ai/graphql-api/mutation/share-meeting */
  async shareMeeting(input: ShareMeetingInput): Promise<ShareMeetingResponse> {
    const query = `
      mutation ShareMeeting($input: ShareMeetingInput!) {
        shareMeeting(input: $input) {
          success
          message
        }
      }
    `;
    const response = await this.executeGraphQL<{ shareMeeting: ShareMeetingResponse }>(query, { input });
    return response.shareMeeting;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/revoke-shared-meeting-access */
  async revokeSharedMeetingAccess(input: RevokeSharedMeetingAccessInput): Promise<RevokeSharedMeetingAccessResponse> {
    const query = `
      mutation RevokeSharedMeetingAccess($input: RevokeSharedMeetingAccessInput!) {
        revokeSharedMeetingAccess(input: $input) {
          success
          message
        }
      }
    `;
    const response = await this.executeGraphQL<{ revokeSharedMeetingAccess: RevokeSharedMeetingAccessResponse }>(query, {
      input
    });
    return response.revokeSharedMeetingAccess;
  }

  // ---------------------------------------------------------------------------
  // Direct file upload (alternative to uploadAudio's public URL)
  // ---------------------------------------------------------------------------

  /**
   * Step 1 of a direct upload: get a pre-signed URL, then PUT the file bytes to
   * `upload_url` with the same `Content-Type`, then call `confirmUpload`.
   * https://docs.fireflies.ai/graphql-api/mutation/create-upload-url
   */
  async createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResponse> {
    const query = `
      mutation CreateUploadUrl($input: CreateUploadUrlInput!) {
        createUploadUrl(input: $input) {
          upload_url
          meeting_id
          expires_at
        }
      }
    `;
    const response = await this.executeGraphQL<{ createUploadUrl: UploadUrlResponse }>(query, { input });
    return response.createUploadUrl;
  }

  /** Step 2 of a direct upload. https://docs.fireflies.ai/graphql-api/mutation/confirm-upload */
  async confirmUpload(meetingId: string): Promise<ConfirmUploadResponse> {
    const query = `
      mutation ConfirmUpload($input: ConfirmUploadInput!) {
        confirmUpload(input: $input) {
          success
          meeting_id
          message
        }
      }
    `;
    const response = await this.executeGraphQL<{ confirmUpload: ConfirmUploadResponse }>(query, {
      input: { meeting_id: meetingId }
    });
    return response.confirmUpload;
  }

  // ---------------------------------------------------------------------------
  // Live meeting controls
  // ---------------------------------------------------------------------------

  /** Pause or resume recording. https://docs.fireflies.ai/graphql-api/mutation/update-meeting-state */
  async updateMeetingState(input: UpdateMeetingStateInput): Promise<UpdateMeetingStateResult> {
    const query = `
      mutation UpdateMeetingState($input: UpdateMeetingStateInput!) {
        updateMeetingState(input: $input) {
          success
          action
        }
      }
    `;
    const response = await this.executeGraphQL<{ updateMeetingState: UpdateMeetingStateResult }>(query, { input });
    return response.updateMeetingState;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/create-live-action-item */
  async createLiveActionItem(input: LivePromptInput): Promise<LiveActionResult> {
    const query = `
      mutation CreateLiveActionItem($input: CreateLiveActionItemInput!) {
        createLiveActionItem(input: $input) {
          success
        }
      }
    `;
    const response = await this.executeGraphQL<{ createLiveActionItem: LiveActionResult }>(query, { input });
    return response.createLiveActionItem;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/create-live-soundbite */
  async createLiveSoundbite(input: LivePromptInput): Promise<LiveActionResult> {
    const query = `
      mutation CreateLiveSoundbite($input: CreateLiveSoundbiteInput!) {
        createLiveSoundbite(input: $input) {
          success
        }
      }
    `;
    const response = await this.executeGraphQL<{ createLiveSoundbite: LiveActionResult }>(query, { input });
    return response.createLiveSoundbite;
  }

  /** https://docs.fireflies.ai/graphql-api/query/live_action_items */
  async getLiveActionItems(meetingId: string): Promise<LiveActionItem[]> {
    const query = `
      query LiveActionItems($meeting_id: ID!) {
        live_action_items(meeting_id: $meeting_id) {
          name
          action_item
        }
      }
    `;
    const response = await this.executeGraphQL<{ live_action_items: LiveActionItem[] }>(query, { meeting_id: meetingId });
    return response.live_action_items;
  }

  // ---------------------------------------------------------------------------
  // AskFred
  // ---------------------------------------------------------------------------

  /** Ask a question about one meeting or across meetings. https://docs.fireflies.ai/graphql-api/mutation/create-askfred-thread */
  async createAskFredThread(input: CreateAskFredThreadInput, filter: string[] = []): Promise<AskFredResponse> {
    const query = `
      mutation CreateAskFredThread($input: CreateAskFredThreadInput!) {
        createAskFredThread(input: $input) {
          message {
            ${selection(filter, DEFAULT_FIELDS.askFredMessage)}
          }
        }
      }
    `;
    const response = await this.executeGraphQL<{ createAskFredThread: AskFredResponse }>(query, { input });
    return response.createAskFredThread;
  }

  /** Ask a follow-up in an existing thread. https://docs.fireflies.ai/graphql-api/mutation/continue-askfred-thread */
  async continueAskFredThread(input: ContinueAskFredThreadInput, filter: string[] = []): Promise<AskFredResponse> {
    const query = `
      mutation ContinueAskFredThread($input: ContinueAskFredThreadInput!) {
        continueAskFredThread(input: $input) {
          message {
            ${selection(filter, DEFAULT_FIELDS.askFredMessage)}
          }
        }
      }
    `;
    const response = await this.executeGraphQL<{ continueAskFredThread: AskFredResponse }>(query, { input });
    return response.continueAskFredThread;
  }

  /** https://docs.fireflies.ai/graphql-api/query/askfred-threads */
  async getAskFredThreads(params: { transcript_id?: string } = {}, filter: string[] = []): Promise<AskFredThreadSummary[]> {
    const query = `
      query AskFredThreads($transcript_id: String) {
        askfred_threads(transcript_id: $transcript_id) {
          ${selection(filter, DEFAULT_FIELDS.askFredThreadSummary)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ askfred_threads: AskFredThreadSummary[] }>(query, params);
    return response.askfred_threads;
  }

  /** A thread with its messages. https://docs.fireflies.ai/graphql-api/query/askfred-thread */
  async getAskFredThread(threadId: string, filter: string[] = []): Promise<AskFredThread> {
    const query = `
      query AskFredThread($id: String!) {
        askfred_thread(id: $id) {
          ${selection(filter, [
            ...DEFAULT_FIELDS.askFredThreadSummary,
            `messages { ${DEFAULT_FIELDS.askFredMessage.join(' ')} error updated_at }`
          ])}
        }
      }
    `;
    const response = await this.executeGraphQL<{ askfred_thread: AskFredThread }>(query, { id: threadId });
    return response.askfred_thread;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/delete-askfred-thread */
  async deleteAskFredThread(threadId: string, filter: string[] = []): Promise<AskFredThreadSummary> {
    const query = `
      mutation DeleteAskFredThread($id: String!) {
        deleteAskFredThread(id: $id) {
          ${selection(filter, DEFAULT_FIELDS.askFredThreadSummary)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ deleteAskFredThread: AskFredThreadSummary }>(query, { id: threadId });
    return response.deleteAskFredThread;
  }

  // ---------------------------------------------------------------------------
  // Channels, contacts, user groups
  // ---------------------------------------------------------------------------

  /** https://docs.fireflies.ai/graphql-api/query/channels */
  async getChannels(filter: string[] = []): Promise<Channel[]> {
    const query = `
      query Channels {
        channels {
          ${selection(filter, DEFAULT_FIELDS.channel)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ channels: Channel[] }>(query);
    return response.channels;
  }

  /** https://docs.fireflies.ai/graphql-api/query/channel */
  async getChannel(channelId: string, filter: string[] = []): Promise<Channel> {
    const query = `
      query Channel($id: ID!) {
        channel(id: $id) {
          ${selection(filter, DEFAULT_FIELDS.channel)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ channel: Channel }>(query, { id: channelId });
    return response.channel;
  }

  /** People you have met with. https://docs.fireflies.ai/graphql-api/query/contacts */
  async getContacts(filter: string[] = []): Promise<Contact[]> {
    const query = `
      query Contacts {
        contacts {
          ${selection(filter, DEFAULT_FIELDS.contact)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ contacts: Contact[] }>(query);
    return response.contacts;
  }

  /** https://docs.fireflies.ai/graphql-api/query/user-groups */
  async getUserGroups(params: { mine?: boolean } = {}, filter: string[] = []): Promise<UserGroup[]> {
    const query = `
      query UserGroups($mine: Boolean) {
        user_groups(mine: $mine) {
          ${selection(filter, DEFAULT_FIELDS.userGroup)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ user_groups: UserGroup[] }>(query, params);
    return response.user_groups;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/add-user-to-user-group */
  async addUserToUserGroup(input: UserGroupMembershipInput, filter: string[] = []): Promise<UserGroup> {
    const query = `
      mutation AddUserToUserGroup($group_id: String!, $user_email: String!) {
        addUserToUserGroup(group_id: $group_id, user_email: $user_email) {
          ${selection(filter, DEFAULT_FIELDS.userGroup)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ addUserToUserGroup: UserGroup }>(query, { ...input });
    return response.addUserToUserGroup;
  }

  /** https://docs.fireflies.ai/graphql-api/mutation/remove-user-from-user-group */
  async removeUserFromUserGroup(input: UserGroupMembershipInput, filter: string[] = []): Promise<UserGroup> {
    const query = `
      mutation RemoveUserFromUserGroup($group_id: String!, $user_email: String!) {
        removeUserFromUserGroup(group_id: $group_id, user_email: $user_email) {
          ${selection(filter, DEFAULT_FIELDS.userGroup)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ removeUserFromUserGroup: UserGroup }>(query, { ...input });
    return response.removeUserFromUserGroup;
  }

  // ---------------------------------------------------------------------------
  // Analytics, audit log, rule executions
  // ---------------------------------------------------------------------------

  /**
   * Team and per-user meeting analytics. Pass `filter` to choose the fields;
   * see https://docs.fireflies.ai/graphql-api/query/analytics for the full shape.
   */
  async getAnalytics(params: AnalyticsQueryParams = {}, filter: string[] = []): Promise<AnalyticsData> {
    const query = `
      query Analytics($start_time: String, $end_time: String) {
        analytics(start_time: $start_time, end_time: $end_time) {
          ${selection(filter, DEFAULT_FIELDS.analytics)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ analytics: AnalyticsData }>(query, params);
    return response.analytics;
  }

  /** One page of audit events; pass `next_cursor` back as `cursor`. https://docs.fireflies.ai/graphql-api/query/audit-events */
  async getAuditEvents(params: AuditEventsQueryParams, filter: string[] = []): Promise<AuditEventsPage> {
    const query = `
      query AuditEvents($limit: Int, $cursor: String, $filters: AuditEventFiltersInput!) {
        auditEvents(limit: $limit, cursor: $cursor, filters: $filters) {
          ${selection(filter, DEFAULT_FIELDS.auditEvents)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ auditEvents: AuditEventsPage }>(query, { ...params });
    return response.auditEvents;
  }

  /** Rule (automation) executions grouped by meeting. https://docs.fireflies.ai/graphql-api/query/rule-executions-by-meeting */
  async getRuleExecutionsByMeeting(
    params: RuleExecutionsQueryParams = {},
    filter: string[] = []
  ): Promise<RuleExecutionsByMeetingPage> {
    const query = `
      query RuleExecutionsByMeeting(
        $limit: Int
        $cursor: String
        $logs_per_meeting: Int
        $filters: RuleExecutionFiltersInput
      ) {
        rule_executions_by_meeting(
          limit: $limit
          cursor: $cursor
          logs_per_meeting: $logs_per_meeting
          filters: $filters
        ) {
          ${selection(filter, DEFAULT_FIELDS.ruleExecutions)}
        }
      }
    `;
    const response = await this.executeGraphQL<{ rule_executions_by_meeting: RuleExecutionsByMeetingPage }>(query, {
      ...params
    });
    return response.rule_executions_by_meeting;
  }

  /**
   * Get meetings/transcripts for multiple users by providing a list of API keys.
   * This implementation includes batch processing, header-driven rate-limit pacing, and deduplication of meetings.
   * @param apiKeys - Array of API keys for different users
   * @param filter - Fields to include in the response
   * @param outputType - Type of output ('console' or 'json')
   * @returns Promise<{ [key: string]: BatchProcessResult }>
   */
  static async getMeetingsForMultipleUsers(
    apiKeys: string[],
    filter: string[] = [],
    outputType: 'console' | 'json' = 'console'
  ): Promise<{ [key: string]: BatchProcessResult }> {
    if (!apiKeys.length) {
      throw new Error('Please provide at least one API key');
    }

    // One client per API key, shared by the ID discovery and the detail
    // fetches, so the batch helper paces itself from the X-RateLimit-* headers
    // of every request made with that key — including the listing calls.
    const clients: { [key: string]: FirefliesSDK } = {};
    for (const apiKey of apiKeys) clients[apiKey] = new FirefliesSDK({ apiKey });

    const deduplicatedObj = await MeetingsHelper.getDedeuplicatedMeetingIds(apiKeys, clients);
    const results: { [key: string]: BatchProcessResult } = {};

    for (const apiKey of Object.keys(deduplicatedObj)) {
      const sdk = clients[apiKey];
      const label = `key #${apiKeys.indexOf(apiKey) + 1}`;
      const tasks = deduplicatedObj[apiKey].map(item => async () => {
        return { data: { transcript: await sdk.getTranscript(item, filter) } };
      });

      try {
        const result = await MeetingsHelper.batchProcess(tasks, apiKey, { rateLimitSource: sdk, label });
        results[apiKey] = result;

        // Handle output
        await MeetingsHelper.handleOutput(result, apiKey, outputType);
      } catch (error) {
        if (error instanceof Error) {
          console.error(
            `An error occurred while fetching meetings for ${label}`,
            error.message
          );
        }
        results[apiKey] = {
          meetings: [],
          errors: [error instanceof Error ? error.message : 'Unknown error']
        };
      }
    }

    return results;
  }

  /**
   * Find questions asked by external participants in meetings
   * @param companyEmailDomain - Your company email domain (e.g. '@company.com')
   * @returns Promise<{ externalParticipants: string[], questions: string[] }>
   */
  async findExternalParticipantQuestions(companyEmailDomain: string): Promise<{
    externalParticipants: string[];
    questions: string[];
  }> {
    if (!companyEmailDomain.startsWith('@')) {
      throw new Error('Company email domain must start with @');
    }

    const query = `
      query Transcripts {
        transcripts {
          participants
          sentences {
            ai_filters {
              question
            }
            speaker_name
          }
        }
      }
    `;

    const response = await this.executeGraphQL<{
      transcripts: Array<{
        participants: string[];
        sentences: Array<{
          ai_filters: { question: string };
          speaker_name: string;
        }>;
      }>
    }>(query);

    const results = response.transcripts;

    // Find external participants by querying emails != companyEmailDomain
    const externalParticipants = [
      ...new Set(
        results
          .map(transcript =>
            transcript.participants
              .filter(participant => !participant.endsWith(companyEmailDomain))
              .map(email => email.split('@')[0])
          )
          .flat()
      )
    ];

    // Find questions from external participants by comparing speaker_name to email

    const questionsFromExternalParticipants = results
      .map(transcript =>
        transcript.sentences
          .filter(sentence => {
            if (!sentence.speaker_name) {
              return false;
            }
            const regexPattern = new RegExp(
              '^' + sentence.speaker_name.split(' ')[0],
              'i'
            );

            return (
              externalParticipants.some(participant =>
                regexPattern.test(participant)
              ) &&
              sentence.ai_filters.question &&
              sentence.speaker_name
            );
          })
          .map(
            sentence =>
              `${sentence.speaker_name}: ${sentence.ai_filters.question}`
          )
      )
      .flat()
      .filter(Boolean);

    return {
      externalParticipants,
      questions: questionsFromExternalParticipants
    };
  }

  /**
   * Get video URLs from meetings/transcripts
   * @returns Promise<Array<{ id: string, title: string, video_url: string | null }>>
   */
  async getMeetingVideos(): Promise<Array<{ id: string; title: string; video_url: string | null }>> {
    const query = `
      query Transcripts {
        transcripts {
          id
          title
          video_url
        }
      }
    `;

    const response = await this.executeGraphQL<{
      transcripts: Array<{
        id: string;
        title: string;
        video_url: string | null;
      }>;
    }>(query);

    return response.transcripts;
  }

  /**
   * Get summary of a specific transcript/meeting
   * @param transcriptId - ID of the transcript to get summary for
   * @returns Promise<Summary>
   */
  async getTranscriptSummary(transcriptId: string): Promise<Summary> {
    const query = `
      query Transcript($transcriptId: String!) {
        transcript(id: $transcriptId) {
          summary {
            keywords
            action_items
            outline
            shorthand_bullet
            overview
            bullet_gist
            gist
            short_summary
            short_overview
            meeting_type
            topics_discussed
            transcript_chapters
          }
        }
      }
    `;

    const response = await this.executeGraphQL<{
      transcript: {
        summary: Summary;
      };
    }>(query, { transcriptId });

    return response.transcript.summary;
  }
}

// Re-export types for convenience
export * from './types'; 