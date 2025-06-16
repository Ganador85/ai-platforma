document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  if (loginForm) {
    const loginEmail = document.getElementById("login-email");
    const loginPassword = document.getElementById("login-password");

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = loginEmail.value.trim();
      const password = loginPassword.value.trim();

      if (!email || !password) {
        return alert("Užpildykite abu laukelius.");
      }

      try {
        const response = await fetch("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const result = await response.json();
        if (response.ok) {
          window.location.href = "index.html";
        } else {
          alert(result.error || "Prisijungimo klaida.");
        }
      } catch (error) {
        alert("Tinklo klaida.");
        console.error(error);
      }
    });
  }

  if (registerForm) {
    const registerEmail = document.getElementById("register-email");
    const registerPassword = document.getElementById("register-password");

    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = registerEmail.value.trim();
      const password = registerPassword.value.trim();

      if (!email || !password) {
        return alert("Užpildykite abu laukelius.");
      }

      if (password.length < 8) {
        return alert("Slaptažodis turi būti bent 8 simbolių ilgio.");
      }

      try {
        const response = await fetch("/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const result = await response.json();
        if (response.ok) {
          alert(result.message || "Vartotojas sukurtas sėkmingai.");
          window.location.href = "auth.html"; // automatinis perėjimas į prisijungimą
        } else {
          alert(result.error || "Registracijos klaida.");
        }
      } catch (error) {
        alert("Tinklo klaida.");
        console.error(error);
      }
    });
  }
});