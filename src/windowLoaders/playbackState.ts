export type TrackSummary = { id: string; name: string; imageUrl: string };

export type PlaybackState = {
    songTitle: string;
    albumArtUrl: string;
    /** Resolved dance for the current track; the partner-dance toggle overrides what is shown. */
    danceTitle: string;
    upNext: TrackSummary[];
    tutorialUrl: string | null;
    partnerDance: boolean;
    queueHidden: boolean;
    profileImageUrl: string;
    profileName: string;
};

let state: PlaybackState = {
    songTitle: "",
    albumArtUrl: "",
    danceTitle: "",
    upNext: [],
    tutorialUrl: null,
    partnerDance: false,
    queueHidden: false,
    profileImageUrl: "",
    profileName: "",
};

const listeners = new Set<() => void>();

export function getPlaybackState(): Readonly<PlaybackState> {
    return state;
}

export function updatePlaybackState(patch: Partial<PlaybackState>): void {
    state = { ...state, ...patch };
    document.body.classList.toggle("queue-hidden", state.queueHidden);
    listeners.forEach((listener) => listener());
}

export function subscribePlaybackState(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** What the dance title widgets show. */
export function displayedDanceTitle(): string {
    return state.partnerDance ? "Partner Dance" : state.danceTitle;
}

/** What the QR widgets show; partner dances have no line dance tutorial. */
export function displayedTutorialUrl(): string | null {
    return state.partnerDance ? null : state.tutorialUrl;
}

export const PARTNER_DANCE_KEY = "partnerDanceActive";
export const QUEUE_HIDDEN_KEY = "upNextHidden";
