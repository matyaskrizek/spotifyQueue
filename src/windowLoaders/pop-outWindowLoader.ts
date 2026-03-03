import {compressAndStore} from "../fileCompression/fileCompressor.ts";


const BG_IMG_STORAGE_KEY = "customBackgroundImage";

export let partnerDanceActive = false;

export function openPopout() {
    const popout = window.open(
        window.location.href,
        "SpotifyQueuePopout",
        "width=1200,height=800,resizable,scrollbars"
    );

    if (!popout) {
        alert("Pop-out blocked by browser! Please allow pop-ups.");
    } else {
        // store reference globally on the main/original window
        (window as any).popoutRef = popout;

        // optional: wait until popout loads before syncing content
        popout.addEventListener("load", () => {
            console.log("Pop-out loaded, syncing PartnerDance state…");
        });

    }
}


// Fullscreen toggle
export function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

export function setupWindowControls() {
    if (window.opener) {
        // In pop-out
        (document.getElementById("openPopoutBtn") as HTMLButtonElement)?.style.setProperty("display", "none");
        (document.getElementById("fullscreenBtn") as HTMLButtonElement)?.style.setProperty("display", "inline-block");
        (document.getElementById("profile") as HTMLElement)?.style.setProperty("display", "none");
        (document.getElementById("uploadBgBtn") as HTMLElement)?.style.setProperty("display", "none");
        (document.getElementById("partnerDanceBtn") as HTMLElement)?.style.setProperty("display", "none");
        (document.getElementById("hideQueueBtn") as HTMLElement)?.style.setProperty("display", "none");

    } else {
        // In main/original
        (document.getElementById("openPopoutBtn") as HTMLButtonElement)?.style.setProperty("display", "inline-block");
        (document.getElementById("fullscreenBtn") as HTMLButtonElement)?.style.setProperty("display", "none");
    }
}

export function initFullscreenButton(buttonId: string = "fullscreenBtn") {
    const fullscreenBtn = document.getElementById(buttonId) as HTMLButtonElement;
    if (!fullscreenBtn) return;

    let hideTimeout: number | null = null;

    const showFullscreenBtn = () => {
        fullscreenBtn.classList.add("visible");

        if (hideTimeout !== null) {
            clearTimeout(hideTimeout);
        }

        hideTimeout = window.setTimeout(() => {
            fullscreenBtn.classList.remove("visible");
            hideTimeout = null;
        }, 5000);
    };

    fullscreenBtn.addEventListener("click", () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });

    // Show button on mouse movement or entering the window
    window.addEventListener("mousemove", showFullscreenBtn);
    window.addEventListener("mouseenter", showFullscreenBtn);

    // Optional: initially hide
    fullscreenBtn.classList.remove("visible");
}

/* Button to show Partner Dance as Dance Title */
export function setupPartnerDanceButton() {
    const partnerDanceBtn = document.getElementById("partnerDanceBtn") as HTMLButtonElement | null;
    const danceTitle = document.getElementById("danceTitle");

    if (!partnerDanceBtn || !danceTitle) return;

    const qrCodeContainer = document.getElementById("qrCodeContainer");

    // Hide button in pop-out
  /*  console.log("window opener: ", window.opener);
    if (window.opener) {
        partnerDanceBtn.style.display = "none";
        return;
    }*/


    function updateDanceTitles() {
        //console.log("PARTNER DANCE BUTTON HIT!");
        if (partnerDanceActive) {
            // @ts-ignore
            danceTitle.textContent = "Partner Dance";
            // @ts-ignore
            danceTitle.style.visibility = "visible";

            // hide QR code
            // @ts-ignore
            qrCodeContainer.style.visibility = "hidden";

            if ((window as any).popoutRef && !(window as any).popoutRef.closed) {
                const popDoc = (window as any).popoutRef.document;
                const popDanceTitle = popDoc.getElementById("danceTitle");
                if (popDanceTitle) {
                    popDanceTitle.textContent = "Partner Dance";
                    popDanceTitle.style.visibility = "visible";
                }

                const popQrCodeContainer = popDoc.getElementById("qrCodeContainer")
                popQrCodeContainer.style.visibility = "hidden";
            }
        } else {
            // @ts-ignore
            danceTitle.textContent = "";
            // @ts-ignore
            danceTitle.style.visibility = "hidden";

            // show QR code
            // @ts-ignore
            qrCodeContainer.style.visibility = "visible";
            // clear QR code; it will be re-populated next time the song changes
            // @ts-ignore
            qrCodeContainer.innerHTML = "";

            if ((window as any).popoutRef && !(window as any).popoutRef.closed) {
                const popDoc = (window as any).popoutRef.document;
                const popDanceTitle = popDoc.getElementById("danceTitle");
                if (popDanceTitle) {
                    popDanceTitle.textContent = "";
                    popDanceTitle.style.visibility = "hidden";
                }
                const popQrCodeContainer = popDoc.getElementById("qrCodeContainer")
                // show QR code
                popQrCodeContainer.style.visibility = "visible";
                // clear QR code; it will be re-populated next time the song changes
                popQrCodeContainer.innerHTML = "";
            }
        }
    }

    partnerDanceBtn.addEventListener("click", () => {
        partnerDanceActive = !partnerDanceActive;
        updateDanceTitles();
    });

    // Expose reset for song change
    /*(window as any).resetDanceTitle = () => {
        partnerDanceActive = false;
        console.log("Reseting Dance Title");
        updateDanceTitles();
    };*/
}

function applyBackground(imageUrl: string) {
    if (!imageUrl) return;
    const bgImage = document.getElementById("bgImage") as HTMLImageElement;
    const bgVideo = document.getElementById("bgVideo") as HTMLVideoElement;
    if (bgVideo) bgVideo.style.display = "none";

    bgImage.src = imageUrl;
    bgImage.style.display = "block";
}

export function setupBackground() {
    const cachedImage = localStorage.getItem(BG_IMG_STORAGE_KEY);
    if (cachedImage) {
        applyBackground(cachedImage);
    }
}

export function setupBackgroundUploadButton() {
    const uploadBgBtn = document.getElementById("uploadBgBtn")!;
    const bgUploadInput = document.getElementById("bgUploadInput")!;
    const bgImage = document.getElementById("bgImage") as HTMLImageElement;
    console.log("setting up background");

    // Handle background uploads
    uploadBgBtn.addEventListener("click", () => bgUploadInput.click());

    bgUploadInput.addEventListener("change", (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target?.result as string;

            // Hide video if it exists
            const bgVideo = document.getElementById("bgVideo") as HTMLVideoElement;
            if (bgVideo) bgVideo.style.display = "none";

            // Replace the image source
            bgImage.src = imageUrl;
            bgImage.style.display = "block";

            // ✅ Cache the image (as Base64)
            try {
                compressAndStore(file)
            } catch (err) {
                console.warn("Failed to save background image to localStorage (maybe too large):", err);
            }

            /*window.dispatchEvent(new StorageEvent("storage", {
                key: BG_IMG_STORAGE_KEY,
                newValue: imageUrl,
            }));*/
        };
        reader.readAsDataURL(file);
    });
}

export function initHideQueueButton(buttonId: string = "hideQueueBtn") {
    const hideQueueBtn = document.getElementById(buttonId) as HTMLButtonElement;
    if (!hideQueueBtn) return;
    const upNextQueue = document.getElementById("upNextColumn");
    hideQueueBtn.addEventListener("click", () => {
        if (!upNextQueue) return;
        else if (upNextQueue.style.visibility == "hidden"){
            // Trigger storage event
            localStorage.setItem("upNextHidden", "false");
            upNextQueue.style.visibility = "visible";
        } else {
            localStorage.setItem("upNextHidden", "true");
            upNextQueue.style.visibility = "hidden";
        }
    });
}




// Event listener to make sure all updates to one window happen to others
window.addEventListener("storage", (event) => {
    if (event.key === BG_IMG_STORAGE_KEY && event.newValue) {
        applyBackground(event.newValue);
    }
});

window.addEventListener("storage", (event) => {
    if (event.key === "upNextHidden") {
        const upNextQueue = document.getElementById("upNextColumn");
        if (!upNextQueue) return;
        upNextQueue.style.visibility = event.newValue === "true" ? "hidden" : "visible";
    }
});



