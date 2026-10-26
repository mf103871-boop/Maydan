import React from "../../design/react.js";

export function Flag({ spec }) {
  const s = spec;
  let body = null;
  const hStripes = (cols, x0 = 0) =>
    cols.map((col, i) =>
      React.createElement("rect", {
        key: i,
        x: x0,
        y: (200 / cols.length) * i,
        width: 300 - x0,
        height: 200 / cols.length,
        fill: col,
      }),
    );
  if (s.t === "h") body = hStripes(s.c);
  else if (s.t === "v")
    body = s.c.map((col, i) =>
      React.createElement("rect", {
        key: i,
        x: (300 / s.c.length) * i,
        y: "0",
        width: 300 / s.c.length,
        height: 200,
        fill: col,
      }),
    );
  else if (s.t === "circle")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
      React.createElement("circle", { cx: s.cx || 150, cy: "100", r: s.r || 60, fill: s.c }),
    );
  else if (s.t === "nordic")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
      React.createElement("rect", { x: "85", y: "0", width: "34", height: 200, fill: s.cross }),
      React.createElement("rect", { x: "0", y: "83", width: 300, height: "34", fill: s.cross }),
    );
  else if (s.t === "swiss")
    body = React.createElement(
      React.Fragment,
      null,
      React.createElement("rect", { x: "50", width: "200", height: 200, fill: "#DA291C" }),
      React.createElement("rect", { x: "135", y: "40", width: "30", height: "120", fill: "#fff" }),
      React.createElement("rect", { x: "90", y: "85", width: "120", height: "30", fill: "#fff" }),
    );
  else if (s.t === "hoist")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(s.c, 75),
      React.createElement("rect", { x: "0", y: "0", width: "75", height: 200, fill: s.bar }),
    );
  else if (s.t === "tri")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(s.c),
      React.createElement("polygon", { points: "0,0 " + (s.w || 110) + ",100 0,200", fill: s.tri }),
    );
  else if (s.t === "kuwait")
    body = React.createElement(
      React.Fragment,
      null,
      hStripes(["#007A3D", "#fff", "#CE1126"]),
      React.createElement("polygon", { points: "0,0 75,67 75,133 0,200", fill: "#000" }),
    );
  else if (s.t === "serrated") {
    const n = s.n,
      bw = 90,
      pts = ["0,0", bw + ",0"];
    for (let i = 1; i <= 2 * n; i++)
      pts.push((i % 2 ? bw + 30 : bw) + "," + (i * (200 / (2 * n))).toFixed(1));
    (pts.push("0,200"),
      (body = React.createElement(
        React.Fragment,
        null,
        React.createElement("rect", { width: 300, height: 200, fill: s.bg }),
        React.createElement("polygon", { points: pts.join(" "), fill: "#fff" }),
      )));
  }
  return React.createElement(
    "svg",
    {
      viewBox: "0 0 300 200",
      className: "w-full max-w-xs mx-auto rounded-lg",
      style: { display: "block", boxShadow: "0 10px 30px rgba(0,0,0,.45)" },
    },
    body,
  );
}
