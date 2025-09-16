export function openPopout() {
    const popout = window.open(
        window.location.href, // exact copy of current page
        "SpotifyQueuePopout",
        "width=1200,height=800,resizable,scrollbars"
    );

    if (!popout) {
        alert("Pop-out blocked by browser! Please allow pop-ups.");
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
