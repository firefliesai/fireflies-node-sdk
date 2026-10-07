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
  fromDate?: string;  // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  toDate?: string;    // ISO 8601 format: YYYY-MM-DDTHH:mm.sssZ
  date?: number;      // deprecated - milliseconds since epoch
  limit?: number;     // max 50
  skip?: number;
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
  title: string;
  webhook?: string;
  custom_language?: string;
  save_video?: boolean;
  attendees?: AudioUploadAttendee[];
  client_reference_id?: string;
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
  privacies?: string[]; // ['public', 'team', 'participants']
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