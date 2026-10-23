// Load the Line Dance Map from the text file
export async function loadSongDanceMap(fileUrl: string): Promise<Map<string, string>> {
    try{
        const response = await fetch(fileUrl);

        if (!response.ok) throw new Error(`Failed to fetch ${fileUrl}: ${response.statusText}`);

        return parseSongDanceMap(await response.text());
    } catch (err) {
        console.error("Error loading LineDanceMasterList", err);
        return new Map<string, string>()
    }
}

/** Parses "song,dance" lines (values may be quoted to contain commas) into a song → dance map. */
export function parseSongDanceMap(text: string): Map<string, string> {
    const map = new Map<string, string>();

    // Split lines and parse each as CSV
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
    for (const line of lines) {
        const [songName, danceName] = parseCSVLine(line);
        if (songName && danceName) {
            map.set(songName, danceName);
        }
    }

    return map;
}

// CSV line parser: handles quoted values with commas
function parseCSVLine(line: string): [string, string] {
    const regex = /("([^"]*)"|[^,]+)(?=\s*,|\s*$)/g;
    const matches: string[] = [];
    let match;

    while ((match = regex.exec(line)) !== null) {
        // If quoted, take group 2, else group 0
        matches.push(match[2] ?? match[0].trim());
    }

    // Expect exactly 2 fields: [songName, danceName]
    return [matches[0] || "", matches[1] || ""];
}
