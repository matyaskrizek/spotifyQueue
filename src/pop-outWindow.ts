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

    // Hide button in pop-out
    console.log("window opener: ", window.opener);
    if (window.opener) {
        partnerDanceBtn.style.display = "none";
        return;
    }

    let partnerDanceActive = false;

    function updateDanceTitles() {
        if (partnerDanceActive) {
            // @ts-ignore
            danceTitle.textContent = "Partner Dance";
            // @ts-ignore
            danceTitle.style.visibility = "visible";

            if ((window as any).popoutRef && !(window as any).popoutRef.closed) {
                const popDoc = (window as any).popoutRef.document;
                const popDanceTitle = popDoc.getElementById("danceTitle");
                if (popDanceTitle) {
                    popDanceTitle.textContent = "Partner Dance";
                    popDanceTitle.style.visibility = "visible";
                }
            }
        } else {
            // @ts-ignore
            danceTitle.textContent = "";
            // @ts-ignore
            danceTitle.style.visibility = "hidden";

            if ((window as any).popoutRef && !(window as any).popoutRef.closed) {
                const popDoc = (window as any).popoutRef.document;
                const popDanceTitle = popDoc.getElementById("danceTitle");
                if (popDanceTitle) {
                    popDanceTitle.textContent = "";
                    popDanceTitle.style.visibility = "hidden";
                }
            }
        }
    }

    partnerDanceBtn.addEventListener("click", () => {
        partnerDanceActive = !partnerDanceActive;
        updateDanceTitles();
    });

    // Expose reset for song change
    (window as any).resetDanceTitle = () => {
        partnerDanceActive = false;
        updateDanceTitles();
    };
}



