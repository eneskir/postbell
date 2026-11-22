const soon = document.querySelector(".soon");
const [front, back] = soon.querySelectorAll(".soon-face");

soon.addEventListener("click", () => {
  const flipped = soon.classList.toggle("is-flipped");
  front.setAttribute("aria-hidden", String(flipped));
  back.setAttribute("aria-hidden", String(!flipped));
});
