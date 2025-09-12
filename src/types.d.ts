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
    currently_playing: TrackObject | EpisodeObject;
    queue: (TrackObject | EpisodeObject)[];
}

interface TrackObject {
    id: string;
    name: string;
    album: {
        images: Image[];
        name: string;
    };
}

interface EpisodeObject {
    id: string;
    name: string;
    images: Image[];
}



type QueueItem = TrackObject | EpisodeObject;