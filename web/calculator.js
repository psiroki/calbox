
const context = CalculateCore.newContext();

const results = document.querySelector("#results");
const inputLine = document.querySelector("#inputLine");

function selectTargetContents(event) {
  const r = document.createRange();
  r.selectNodeContents(event.currentTarget);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function div(text) {
  const result = document.createElement("div");
  result.textContent = String(text);
  result.addEventListener("click", selectTargetContents);
  return result;
}

inputLine.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const expression = e.currentTarget.value;
    const d = div(expression);
    d.classList.add("q");
    const prog = CalculateCore.newProgram(expression);
    console.log(prog.toString());
    const result = prog.execute(context);
    context.setRegister("last", result);
    const r = div(result);
    r.classList.add("a");
    results.append(d, r);
    e.currentTarget.select();
  }
});
