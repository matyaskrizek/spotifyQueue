interface UserProfile {
    country: string;
    display_name: string;
    email: string;
    explicit_content: {
        filter_enabled: boolean,
        filter_locked: boolean
    },
    external_urls: { spotify: string; };
    followers: { href: string; total: number; };
    href: string;
    id: string;
    images: Image[];
    product: string;
    type: string;
    uri: string;
}

interface Image {
    url: string;
    height: number;
    width: number;
}

interface FullQueue {
    currently_playing: CurrentlyPlaying;
    music_queue: MusicQueue;
}

interface MusicQueue {
    tracks: TrackObject[] | EpisodeObject[];

}

interface CurrentlyPlaying {
    track: TrackObject | EpisodeObject;
}

interface EpisodeObject {
    id: string;
    audio_preview_url: string;
    description: string;
    html_description: string;
    duration_ms: number;
    explicit: boolean;
    external_urls: ExternalUrls;
    href: string;
    images: Image[];
    is_externally_hosted: boolean;
    is_playable: boolean;
    language: string;
    languages: string[];
    name: string;
    release_date: string;
    release_date_precision: string;
    resume_point: ResumPoint;
    type: string;
    uri: string;
    restrictions: Restrictions;
    show: Show;
}

interface TrackObject {
    id: string;
    album: Album;
    artists: Artist[];
    available_markets: string[];
    disc_number: number;
    duration_ms: number;
    explicit: boolean;
    external_urls: ExternalUrls;
    external_ids: ExternalIds;
    href: string;
    is_playable: boolean;
    restrictions: Restrictions;
    name: string;
    popularity: number;
    preview_url: string;
    track_number: number;
    type: string;
    uri: string;
    is_local: boolean;

}

interface Album {
    id: string;
    name: string;
    album_type: string;
    total_tracks: number;
    available_markets: string[];
    href: string;
    images: Image[];
    release_date: string;
    release_date_precision: string;
    type: string;
    uri: string;
    artists: Artist[];
    restrictions: Restrictions;
}

interface Artist {
    id: string;
    external_urls: ExternalUrls;
    href: string;
    name: string;
    type: string;
    uri: string;
}

interface ResumPoint {
    fully_played: boolean;
    resume_position_ms: number;
}

interface Show {
    id: string;
    available_markets: string[];
    copyrights: Copyrights[];
    description: string;
    html_description: string;
    explicit: boolean;
    external_urls: ExternalUrls;
    href: string;
    images: Image[];
    is_externally_hosted: boolean;
    languages: string[];
    media_type: string;
    name: string;
    publisher: string;
    type: string;
    uri: string;
    total_episodes: number;
}

interface Copyrights {
    text: string;
    type: string;
}

interface ExternalUrls {
    spotify: string;
}

interface Restrictions {
    reason: string;
}

interface ExternalIds {
    isrc: string;
    ean: string;
    upc: string;
}