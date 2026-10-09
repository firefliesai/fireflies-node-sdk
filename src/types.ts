import { AxiosInstance } from 'axios';
import type { RateLimitRetryOptions } from './rate-limit';

export interface FirefliesConfig {
  apiKey: string;
  baseURL?: string;
  /**
   * Automatic retry of rate-limited (`429` / `too_many_requests`) requests.
   * Defaults: 3 retries, waits of up to 65 s. Pass `{ maxRetries: 0 }` to disable.
   * See https://docs.fireflies.ai/fundamentals/limits
   */
  rateLimit?: RateLimitRetryOptions;
}

export interface AIAppOutput {
  transcript_id: string;
  user_id: string;
  app_id: string;
  created_at: string;
  title: string;
  prompt: string;
  response: string;
}

export interface AIAppsQueryParams {
  app_id?: string;
  transcript_id?: string;
  skip?: number;
  limit?: number;
}

export interface UserData {
  user_id: string;
  recent_transcript: string;
  recent_meeting: string;
  num_transcripts: number;
  name: string;
  minutes_consumed: number;
  is_admin: boolean;
  integrations: string[];
  email: string;
}

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

export interface TranscriptData {
  id: string;
  dateString: string;
  privacy: string;
  speakers: Speaker[];
  sentences: Sentence[];
  title: string;
  host_email: string;
  organizer_email: string;
  calendar_id: string;
  user: UserData;
  fireflies_users: string[];
  participants: string[];
  date: string;
  transcript_url: string;
  audio_url: string;
  video_url: string;
  duration: number;
  meeting_attendees: MeetingAttendee[];
  summary: Summary;
  cal_id: string;
  calendar_type: string;
  apps_preview: {
    outputs: AIAppOutput[];
  };
  meeting_link: string;
}

export interface TranscriptsQueryParams {
  title?: string;
  /** Search text; combine with `scope`. Mutually exclusive with `title`. */
  keyword?: string;
  /** Where `keyword` searches: `title`, `sentences` or `all`. */
  scope?: TranscriptsQueryScope;
  fromDate?: string;  // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  toDate?: string;    // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  date?: number;      // deprecated - milliseconds since epoch
  limit?: number;     // max 50
  skip?: number;      // max 5000
  /** Meetings organized by any of these emails. */
  organizers?: string[];
  /** Meetings with any of these participants. */
  participants?: string[];
  channel_id?: string;
  host_email?: string;
  organizer_email?: string;
  participant_email?: string;
  user_id?: string;
  mine?: boolean;
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

export interface BiteData {
  transcript_id: string;
  name: string;
  id: string;
  thumbnail: string;
  preview: string;
  status: string;
  summary: string;
  user_id: string;
  start_time: number;
  end_time: number;
  summary_status: string;
  media_type: string;
  created_at: string;
  created_from: BiteCreatedFrom;
  captions: BiteCaption[];
  sources: BiteSource[];
  privacies: string[];
  user: BiteUser;
}

export interface BitesQueryParams {
  mine?: boolean;
  transcript_id?: string;
  my_team?: boolean;
  limit?: number;  // Maximum of 50
  skip?: number;
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user'
}

export interface SetUserRoleResponse {
  name: string;
  is_admin: boolean;
}

export interface DeleteTranscriptResponse {
  title: string;
  date: number;
  duration: number;
  organizer_email: string;
}

export interface AudioUploadAttendee {
  displayName: string;
  email: string;
  phoneNumber?: string;
}

export interface AudioUploadInput {
  url: string;  // Must be HTTPS and publicly accessible
  title?: string;
  webhook?: string;  // HTTPS
  custom_language?: string;
  save_video?: boolean;
  attendees?: AudioUploadAttendee[];
  client_reference_id?: string;
  /** Skip the minimum-size check for very short recordings. */
  bypass_size_check?: boolean;
  /** Credentials the API uses to download `url`. */
  download_auth?: DownloadAuthInput;
  /** RFC 3339 date or date-time of the original meeting. */
  meeting_date?: string;
}

export interface AudioUploadResponse {
  success: boolean;
  title: string;
  message: string;
}

export interface CreateBiteInput {
  transcript_id: string;
  name?: string;
  start_time: number;  // in seconds
  end_time: number;    // in seconds
  media_type?: string; // 'video' or 'audio'
  privacies?: BitePrivacy[];
  summary?: string;
}

export interface CreateBiteResponse {
  status: string;
  name: string;
  id: string;
}

export interface LiveMeetingAttendee {
  displayName: string;
  email: string;
  phoneNumber?: string;
}

export interface AddToLiveMeetingInput {
  meeting_link: string;
  title?: string;
  meeting_password?: string;
  duration?: number;  // in minutes, min: 15, max: 120, default: 60
  language?: string;
  attendees?: LiveMeetingAttendee[];
}

export interface AddToLiveMeetingResponse {
  success: boolean;
}

export interface TranscriptParams {
  limit?: number;      // max 50
  mine?: boolean;      // Get meetings where API key owner is organizer
  fromDate?: string;   // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  toDate?: string;     // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  date?: number;       // milliseconds since epoch
  skip?: number;
  hostEmail?: string;
  organizerEmail?: string;
  participantEmail?: string;
  userId?: string;
} 
// ---------------------------------------------------------------------------
// Types for the rest of the public GraphQL API surface (docs.fireflies.ai).
// Field names follow the GraphQL schema (snake_case), like the types above.
// ---------------------------------------------------------------------------

/** Who can access a meeting. */
export type MeetingPrivacy =
  | 'link'
  | 'owner'
  | 'participants'
  | 'participatingteammates'
  | 'teammatesandparticipants'
  | 'teammates';

/** State of a meeting the notetaker is in. */
export type MeetingState = 'active' | 'paused';

/** Where `transcripts(keyword:)` searches. */
export type TranscriptsQueryScope = 'title' | 'sentences' | 'all';

/** Who can see a soundbite. */
export type BitePrivacy = 'public' | 'team' | 'participants';

/** Recording control for a live meeting. */
export type MeetingStateAction = 'pause_recording' | 'resume_recording';

/** AskFred answer format. */
export type AskFredFormatMode = 'markdown' | 'plaintext';

export type AskFredMessageStatus = 'processing' | 'completed' | 'failed';

/** How a meeting is shared. */
export type ShareMeetingType = 'email' | 'password-link';

export type AuditEventCategory = 'MEETING_OPERATIONS' | 'TEAM_OPERATIONS' | 'USER_OPERATIONS' | 'AUTHENTICATION';

/**
 * Audit action names (e.g. `MEETING_DELETED`, `TEAMMATE_ADDED`). The server owns the
 * list and adds to it, so any string is accepted; see docs.fireflies.ai/schema/enum/audit-event-action.
 */
export type AuditEventAction = string;

/** Authentication the API uses to download an `uploadAudio` file. */
export type DownloadAuthInput =
  | { type: 'none' }
  | { type: 'bearer_token'; bearer: { token: string } }
  | { type: 'basic_auth'; basic: { username?: string; password: string } };

// --- transcripts --------------------------------------------------------------

export interface ActiveMeetingsQueryParams {
  /** A teammate's email (admins only); defaults to the API key owner. */
  email?: string;
  /** Defaults to both `active` and `paused`. */
  states?: MeetingState[];
}

export interface ActiveMeeting {
  id: string;
  title: string | null;
  organizer_email: string | null;
  meeting_link: string | null;
  start_time: string | null;
  end_time: string | null;
  privacy: MeetingPrivacy | null;
  state: MeetingState | null;
}

export interface UpdateMeetingTitleInput {
  /** Transcript ID. */
  id: string;
  /** Max 256 characters. */
  title: string;
}

export interface UpdateMeetingPrivacyInput {
  /** Transcript ID. */
  id: string;
  privacy: MeetingPrivacy;
}

export interface UpdateMeetingChannelInput {
  /** Up to 5 transcript IDs. */
  transcript_ids: string[];
  channel_id: string;
}

export interface ShareMeetingInput {
  meeting_id: string;
  /** Up to 50 addresses per request. */
  emails: string[];
  /** 7, 14 or 30. */
  expiry_days?: 7 | 14 | 30;
  share_type?: ShareMeetingType;
  /** Required for `password-link` shares. */
  password?: string;
}

export interface ShareMeetingResponse {
  success: boolean;
  message: string | null;
}

export interface RevokeSharedMeetingAccessInput {
  meeting_id: string;
  email: string;
}

export interface RevokeSharedMeetingAccessResponse {
  success: boolean;
  message: string | null;
}

// --- direct upload ------------------------------------------------------------

export interface CreateUploadUrlInput {
  /** MIME type of the file, e.g. `audio/mpeg` or `video/mp4`. */
  content_type: string;
  /** Size in bytes. */
  file_size: number;
  /** Max 256 characters. */
  title?: string;
  /** Language code, e.g. `es`. */
  custom_language?: string;
  /** RFC 3339 date or date-time of the original meeting. */
  meeting_date?: string;
  /** Up to 100. */
  attendees?: AudioUploadAttendee[];
}

export interface UploadUrlResponse {
  /** Pre-signed URL to PUT the file to. */
  upload_url: string;
  /** Pass to `confirmUpload` once the PUT has finished. */
  meeting_id: string;
  expires_at: string;
}

export interface ConfirmUploadResponse {
  success: boolean;
  meeting_id: string;
  message: string;
}

// --- live meetings ------------------------------------------------------------

export interface UpdateMeetingStateInput {
  meeting_id: string;
  action: MeetingStateAction;
}

export interface UpdateMeetingStateResult {
  success: boolean;
  action: MeetingStateAction;
}

export interface LivePromptInput {
  meeting_id: string;
  /** What to capture, max 255 characters. */
  prompt: string;
}

export interface LiveActionResult {
  success: boolean;
}

export interface LiveActionItem {
  name: string | null;
  action_item: string;
}

// --- AskFred ------------------------------------------------------------------

export interface AskFredMeetingFilters {
  /** ISO 8601; at most one year back. Defaults to 30 days before `end_time`. */
  start_time?: string;
  /** ISO 8601; defaults to now. */
  end_time?: string;
  channel_ids?: string[];
  organizers?: string[];
  participants?: string[];
  transcript_ids?: string[];
}

interface AskFredAnswerOptions {
  /** Language code for the answer, e.g. `en`. */
  response_language?: string;
  format_mode?: AskFredFormatMode;
  /** Generate `suggested_queries`; `false` makes the answer faster. */
  generate_suggestions?: boolean;
}

export interface CreateAskFredThreadInput extends AskFredAnswerOptions {
  /** Max 2000 characters. */
  query: string;
  /** Ask about one meeting... */
  transcript_id?: string;
  /** ...or search across meetings (ignored when `transcript_id` is set). */
  filters?: AskFredMeetingFilters;
}

export interface ContinueAskFredThreadInput extends AskFredAnswerOptions {
  thread_id: string;
  /** Max 2000 characters. */
  query: string;
}

export interface AskFredMessage {
  id: string;
  thread_id: string;
  query: string;
  answer: string | null;
  suggested_queries: string[] | null;
  status: AskFredMessageStatus;
  created_at: string;
  updated_at?: string;
}

export interface AskFredResponse {
  message: AskFredMessage;
}

export interface AskFredThreadSummary {
  id: string;
  title: string | null;
  transcript_id: string | null;
  user_id: string;
  created_at: string;
}

export interface AskFredThread extends AskFredThreadSummary {
  messages: AskFredMessage[];
}

// --- channels, contacts, user groups -----------------------------------------

export interface ChannelMember {
  user_id: string;
  email: string;
  name: string;
}

export interface Channel {
  id: string;
  title: string | null;
  is_private: boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  members: ChannelMember[] | null;
}

export interface Contact {
  email: string;
  name: string;
  picture: string | null;
  last_meeting_date: string | null;
}

export interface UserGroupMember {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface UserGroup {
  id: string;
  name: string;
  handle: string;
  members: UserGroupMember[] | null;
}

export interface UserGroupMembershipInput {
  group_id: string;
  user_email: string;
}

// --- analytics ----------------------------------------------------------------

export interface AnalyticsQueryParams {
  /** ISO 8601. */
  start_time?: string;
  /** ISO 8601. */
  end_time?: string;
}

/** Shape depends on the fields you select; see docs.fireflies.ai/schema/analytics. */
export type AnalyticsData = Record<string, any>;

// --- audit events -------------------------------------------------------------

export interface AuditEventFilters {
  category: AuditEventCategory;
  action?: AuditEventAction;
  /** ISO 8601. */
  date_from?: string;
  /** ISO 8601. */
  date_to?: string;
  actor_user_id?: string;
  /** Takes precedence over `actor_user_id`. */
  actor_email?: string;
}

export interface AuditEventsQueryParams {
  filters: AuditEventFilters;
  /** 1-50, default 20. */
  limit?: number;
  /** `next_cursor` from the previous page. */
  cursor?: string;
}

export interface AuditEvent {
  id: string;
  time: string;
  category: AuditEventCategory;
  action: AuditEventAction;
  severity: string;
  status: string;
  message: string | null;
  actor: { user_id: string | null; email: string | null; full_name: string | null; ip_address: string | null } | null;
  resource: { type: string; id: string } | null;
  /** JSON-encoded. */
  metadata: string | null;
}

export interface AuditEventsPage {
  events: AuditEvent[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- rule executions ----------------------------------------------------------

export interface RuleExecutionFilters {
  rule_id?: string;
  meeting_id?: string;
  /** ISO 8601. */
  date_from?: string;
  /** ISO 8601. */
  date_to?: string;
  /** `true` only test runs, `false` only production runs, omitted both. */
  is_test?: boolean;
}

export interface RuleExecutionsQueryParams {
  /** Meeting groups per page, 1-50, default 10. */
  limit?: number;
  cursor?: string;
  /** Executions per meeting, 1-20, default 5. */
  logs_per_meeting?: number;
  filters?: RuleExecutionFilters;
}

export interface RuleExecution {
  extension_id: string;
  extension_title: string;
  stopped_at: string | null;
  user_name: string | null;
  share: { group_ids: string | null } | null;
  channel: { channel_id: string | null } | null;
  meeting_privacy: { privacy: string | null } | null;
}

export interface RuleExecutionsByMeetingPage {
  meetings: Array<{
    meeting_id: string;
    meeting: { id: string; title: string | null; organizer_email: string | null } | null;
    executions: RuleExecution[];
  }>;
  has_more: boolean;
  next_cursor: string | null;
}
