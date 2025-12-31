document.addEventListener("DOMContentLoaded", function () {

  // -----------------------------
  // Elements
  // -----------------------------
  const form = document.getElementById("form");
  const popup = document.getElementById("popup");
  const popupContent = document.querySelector(".popup-content");
  const closeBtn = document.getElementById("close");
  const openBtn = document.getElementById("book");

  // -----------------------------
  // Popup open/close logic (safe)
  // -----------------------------
  if (openBtn && popup) {
    openBtn.addEventListener("click", () => {
      popup.style.display = "flex";
    });
  }

  if (closeBtn && popup) {
    closeBtn.addEventListener("click", () => {
      popup.style.display = "none";
    });
  }

  if (popup && popupContent) {
    popup.addEventListener("click", function (e) {
      if (!popupContent.contains(e.target)) {
        popup.style.display = "none";
      }
    });
  }

  // -----------------------------
  // Convert 24-hour to 12-hour AM/PM
  // -----------------------------
  function formatTime12Hour(time24) {
    if (!time24) return "";
    let [hours, minutes] = time24.split(":").map(Number);
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  }

  // -----------------------------
  // Show styled alert
  // -----------------------------
  function showAlert(message, isError = false) {
    let alertBox = document.getElementById("custom-alert");
    if (!alertBox) {
      alertBox = document.createElement("div");
      alertBox.id = "custom-alert";
      alertBox.className = "custom-alert";
      document.body.appendChild(alertBox);
    }
    alertBox.textContent = message;
    alertBox.classList.toggle("error", isError);
    alertBox.style.display = "block";
    setTimeout(() => alertBox.style.display = "none", 3000);
  }

  // -----------------------------
  // Submit form
  // -----------------------------
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Collect customer info
      const firstname = document.getElementById("firstname")?.value || "";
      const lastname = document.getElementById("lastname")?.value || "";
      const email = document.getElementById("email")?.value || "";
      const tel = document.getElementById("tel")?.value || "";
      const date = document.getElementById("date")?.value || "";
      const time24 = document.getElementById("time")?.value || "";
      const time = formatTime12Hour(time24);

      // Collect services safely
      const legends = document.querySelectorAll(".service-choice");
      const services = Array.from(legends).map(legend => {
        const id = legend.textContent.trim();
        const select = document.getElementById(id);
        if (!select) return null; // skip if select not found
        return select.value ? `${id}: ${select.value}` : null;
      }).filter(v => v).join(", ");

      // Prepare data
      const data = {
        senderName: firstname + " " + lastname,
        receiverEmail: "a@gmail.com",
        customerEmail: email,
        telephone: tel,
        service: services,
        date: date,
        time: time
      };

      // Send via fetch
      try {
        const res = await fetch("http://localhost:3000/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });

        const result = await res.json();

        if (result.success) {
          showAlert("Booking confirmed ✅");
          form.reset();
          if (popup) popup.style.display = "none";
        } else {
          showAlert("Failed to send booking ❌", true);
        }
      } catch (err) {
        console.error("Fetch error:", err);
        showAlert("Error sending booking ❌", true);
      }
    });
  }

});
