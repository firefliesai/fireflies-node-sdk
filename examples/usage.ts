import { FirefliesSDK, UserRole } from '../src/fireflies';
import { TranscriptParams } from '../src/types';
import { FirefliesRateLimitError } from '../src/rate-limit';

class FirefliesUsageExamples {
  private fireflies: FirefliesSDK;

  constructor(apiKey: string) {
    this.fireflies = new FirefliesSDK({
      apiKey
    });
  }

  async getCurrentUser(fields: string[]) {
    const currentUser = await this.fireflies.getCurrentUser(fields);
    return currentUser;
  }

  async getUser(userId: string, fields: string[]) {
    const user = await this.fireflies.getUser(userId, fields);
    return user;
  }

  async getUsers(fields: string[]) {
    const user = await this.fireflies.getUsers(fields);
    return user;
  }

  async getTranscripts(params: TranscriptParams, fields: string[]) {
    const transcripts = await this.fireflies.getTranscripts(params, fields);
    return transcripts;
  }

  async deleteTranscriptExample(transcriptId: string) {
    try {
      const deletedTranscript = await this.fireflies.deleteTranscript(transcriptId);
      console.log('Successfully deleted transcript:', {
        title: deletedTranscript.title,
        date: new Date(deletedTranscript.date).toISOString(),
        duration: deletedTranscript.duration,
        organizerEmail: deletedTranscript.organizer_email
      });
      return deletedTranscript;
    } catch (error) {
      console.error('Failed to delete transcriptsss:', error);
      throw error;
    }
  }

  async userRoleManagementExample(userId: string) {
    // Set a user's role to admin
    const updatedUser = await this.fireflies.setUserRole(userId, UserRole.ADMIN);
    console.log('Updated user role:', {
      name: updatedUser.name,
      isAdmin: updatedUser.is_admin
    });

    // Set a user's role back to regular user
    const revertedUser = await this.fireflies.setUserRole(userId, UserRole.USER);
    console.log('Reverted user role:', {
      name: revertedUser.name,
      isAdmin: revertedUser.is_admin
    });

    return { updatedUser, revertedUser };
  }

  async getBitesExamples() {
    // Get list of bites for the current user
    const myBites = await this.fireflies.getBites({
      mine: true,
      limit: 10
    }, ["id", "name", "status", "end_time", "start_time", "media_type", "created_at"]);
    for (const bite of myBites) {
      console.log('Bite:', {
        name: bite.name,
        status: bite.status,
        duration: bite.end_time - bite.start_time,
        mediaType: bite.media_type,
        createdAt: bite.created_at
      });
    }

    return myBites;
  }

  async getSpecificTranscriptBites(transcriptId: string) {
    const filter = ["id", "name", "status", "end_time", "start_time", "media_type", "created_at"];
    const transcriptBites = await this.fireflies.getBite(transcriptId, filter);
    return transcriptBites;
  }

  async getTeamBites() {
    const teamBites = await this.fireflies.getBites({
      my_team: true,
      limit: 10
    });
    console.log('Team bites:', teamBites.map(b => ({
      name: b.name,
      creator: b.user.name
    })));
    return teamBites;
  }

  async uploadAudioExample(audioUrl: string) {
    const uploadResult = await this.fireflies.uploadAudio({
      url: audioUrl,
      title: 'Important Team Meeting',
      custom_language: 'en',
      save_video: true,
      attendees: [
        {
          displayName: 'John Doe',
          email: 'john@example.com',
          phoneNumber: '+1234567890'
        },
        {
          displayName: 'Jane Smith',
          email: 'jane@example.com'
        }
      ],
      webhook: 'https://your-webhook.com/fireflies-callback',
      client_reference_id: 'meeting-2024-03-21'
    });
    return uploadResult;
  }

  async createBiteExamples(transcriptId: string) {
    // Create a detailed bite
    const newBite = await this.fireflies.createBite({
      transcript_id: transcriptId,
      name: 'Important Discussion Highlight',
      start_time: 120,
      end_time: 180,
      media_type: 'video',
      privacies: ['team', 'participants'],
    });

    console.log('Created new bite:', {
      id: newBite.id,
      name: newBite.name,
      status: newBite.status
    });

    // Create a quick bite
    const quickBite = await this.fireflies.createBite({
      transcript_id: transcriptId,
      start_time: 300,
      end_time: 360
    });

    console.log('Created quick bite:', {
      id: quickBite.id,
      status: quickBite.status
    });

    return { newBite, quickBite };
  }

  async addToLiveMeetingExamples() {
    // Regular meeting
    const liveMeetingResult = await this.fireflies.addToLiveMeeting({
      meeting_link: 'https://meet.google.com/your-meeting-code',
      title: 'Weekly Team Sync',
      duration: 45,
      language: 'en',
      attendees: [
        {
          displayName: 'John Doe',
          email: 'john@example.com',
          phoneNumber: '+1234567890'
        },
        {
          displayName: 'Jane Smith',
          email: 'jane@example.com'
        }
      ]
    });

    // Protected meeting
    const protectedMeetingResult = await this.fireflies.addToLiveMeeting({
      meeting_link: 'https://zoom.us/j/your-meeting-id',
      meeting_password: 'meeting123',
      duration: 60
    });

    return { liveMeetingResult, protectedMeetingResult };
  }

  async getMultipleUserMeetingsExample() {
    const apiKeys = [
      'api-key-1',
      'api-key-2',
      'api-key-3'
    ];

    // Get meetings for multiple users with specific fields
    const meetings = await FirefliesSDK.getMeetingsForMultipleUsers(
      apiKeys,
      [
        'id',
        'title',
        'duration',
        'date',
        'host_email',
        'organizer_email',
        'summary { keywords action_items overview }'
      ],
      'json' // Output results to JSON files
    );

    // Log results summary
    for (const [apiKey, result] of Object.entries(meetings)) {
      console.log(`API Key ${apiKey.split('-')[0]}:`);
      console.log(`- Meetings found: ${result.meetings.length}`);
      console.log(`- Errors encountered: ${result.errors.length}`);
    }

    return meetings;
  }

  async findExternalParticipantQuestionsExample() {
    try {
      const { externalParticipants, questions } = await this.fireflies.findExternalParticipantQuestions('@yourcompany.com');

      console.log('External Participants:', externalParticipants);
      console.log('\nQuestions from External Participants:');
      questions.forEach((question, index) => {
        console.log(`${index + 1}. ${question}`);
      });

      return { externalParticipants, questions };
    } catch (error) {
      console.error('Error finding external participant questions:', error);
      throw error;
    }
  }

  async getMeetingVideosExample() {
    try {
      const meetings = await this.fireflies.getMeetingVideos();
      let numHaveVideo = 0;

      // Log the video URLs
      meetings.forEach(meeting => {
        console.log(
          `${meeting.title} (${meeting.id}) meeting ${meeting.video_url
            ? `has video \n\t- ${meeting.video_url}`
            : `doesn't have a video`
          }\n`
        );
        if (meeting.video_url) numHaveVideo += 1;
      });

      console.log(
        `Found ${meetings.length} meetings to check for video. ${numHaveVideo} have a video`
      );

      return meetings;
    } catch (error) {
      console.error('Error getting meeting videos:', error);
      throw error;
    }
  }

  async rateLimitAwareExample() {
    // Rate-limited (429 / too_many_requests) calls are retried automatically after
    // the server's Retry-After; here we also log each wait and read the quota state.
    const fireflies = new FirefliesSDK({
      apiKey: 'your-api-key',
      rateLimit: {
        maxRetries: 3,
        maxRetryWaitMs: 65_000,
        onRateLimited: ({ attempt, waitMs }) => console.warn(`Rate limited, retry ${attempt} in ${waitMs} ms`)
      }
    });

    try {
      await fireflies.getCurrentUser(['email']);
      // Limits per plan: https://docs.fireflies.ai/fundamentals/limits
      console.log('Rate limit state:', fireflies.rateLimit);
    } catch (error) {
      if (error instanceof FirefliesRateLimitError) {
        console.error(`Still rate limited after ${error.attempts} attempts; retry after ${error.retryAfter}s`);
      }
      throw error;
    }
  }

  async getTranscriptSummaryExample(transcriptId: string) {
    try {
      const summary = await this.fireflies.getTranscriptSummary(transcriptId);

      console.log('Meeting Summary:');
      console.log('Overview:', summary.overview);
      console.log('\nKey Points:');
      console.log('- Meeting Type:', summary.meeting_type);
      console.log('- Topics Discussed:', summary.topics_discussed.join(', '));
      console.log('\nAction Items:');
      summary.action_items.forEach((item, index) => {
        console.log(`${index + 1}. ${item}`);
      });
      console.log('\nKeywords:', summary.keywords.join(', '));

      return summary;
    } catch (error) {
      console.error('Error getting transcript summary:', error);
      throw error;
    }
  }
}

// Example usage:
async function main() {
  try {
    const examples = new FirefliesUsageExamples('your-api-key');

    // const userFields = ["user_id", "email", "name", "num_transcripts"];
    const meetingFields = ["privacy", "id"];

    // Test individual methods
    // let resp = await examples.getCurrentUser(userFields);

    // let resp = await examples.getTranscripts({
    //   limit: 50,
    //   mine: true
    // }, meetingFields);
    // console.log(resp);

    // await examples.deleteTranscriptExample('transcript_id_to_delete');
    // await examples.userRoleManagementExample('target_user_id');
    // let resp = await examples.getBitesExamples();
    // console.log(resp);

    // let resp = await examples.getSpecificTranscriptBites('yGLC8RIcBaO');

    // await examples.getSpecificTranscriptBites('your_transcript_id');

    // await examples.getTeamBites();
    let resp = await examples.uploadAudioExample('https://www.flatworldsolutions.com/transcription/samples/Monologue.mp3');
    console.log(resp);

    // await examples.createBiteExamples('your_transcript_id');
    // await examples.addToLiveMeetingExamples();

    // Example of getting meetings for multiple users
    await examples.getMultipleUserMeetingsExample();

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the examples
main(); 