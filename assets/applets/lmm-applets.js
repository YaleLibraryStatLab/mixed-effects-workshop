(function () {
    "use strict";

    var NS = "http://www.w3.org/2000/svg";

    var FARM = ["#0072B2", "#009E73", "#D55E00", "#E69F00", "#CC79A7"];
    var INK = "#2b2b2b";
    var MUTED = "#6c757d";
    var RULE = "#c9c9c9";
    var FAINT = "#e8e8e8";

    var REDUCED = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------------- small helpers ---------------- */

    function checkNum(name, k, v) {
        if (typeof v === "number" && !isFinite(v) && window.console) {
            console.warn("lmm-applet: non-finite " + k + " on <" + name + ">", v);
        }
        return v;
    }

    function el(name, attrs, parent) {
        var node = document.createElementNS(NS, name);
        if (attrs) {
            for (var k in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, k)) {
                    node.setAttribute(k, checkNum(name, k, attrs[k]));
                }
            }
        }
        if (parent) parent.appendChild(node);
        return node;
    }

    /* Same guard for the update path, where coordinates are reassigned
       on existing nodes rather than set at creation. */
    function setNum(node, k, v) {
        node.setAttribute(k, checkNum(node.nodeName, k, v));
    }

    function htm(name, cls, parent, text) {
        var node = document.createElement(name);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        if (parent) parent.appendChild(node);
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    /* Deterministic PRNG so the figure never changes between renders. */
    function makeRng(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function makeNorm(rng) {
        return function () {
            var u = 0, v = 0;
            while (u === 0) u = rng();
            while (v === 0) v = rng();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };
    }

    function mean(xs) {
        var t = 0;
        for (var i = 0; i < xs.length; i++) t += xs[i];
        return t / xs.length;
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function tween(ms, step, done) {
        /* A zero (or missing) duration must jump straight to the end state.
           Letting it through computes (ts - t0) / 0 on the first frame, which
           is 0/0 = NaN; that propagates into every coordinate, and SVG treats
           an invalid coordinate as 0 rather than erroring, so everything
           silently collapses to the origin and stays there. */
        if (REDUCED || !(ms > 0)) { step(1); if (done) done(); return; }
        var t0 = null;
        function frame(ts) {
            if (t0 === null) t0 = ts;
            var p = Math.min(1, (ts - t0) / ms);
            /* ease in-out cubic */
            var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            step(e);
            if (p < 1) requestAnimationFrame(frame);
            else if (done) done();
        }
        requestAnimationFrame(frame);
    }

    function normPdf(x, mu, sd) {
        var z = (x - mu) / sd;
        return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
    }

    /* Shared frame: builds an svg with a caption slot and control slot. */
    function frame(host, opts) {
        clear(host);
        var wrap = htm("div", "lmm-frame", host);
        var head = htm("div", "lmm-head", wrap);
        htm("p", "lmm-title", head, opts.title);
        var svg = el("svg", {
            viewBox: "0 0 " + opts.w + " " + opts.h,
            xmlns: NS,
            role: "img",
            "aria-label": opts.aria || opts.title
        }, wrap);
        var controls = htm("div", "lmm-controls", wrap);
        var caption = htm("p", "lmm-caption", wrap);
        return { wrap: wrap, svg: svg, controls: controls, caption: caption };
    }

    function button(parent, label, onClick) {
        var b = htm("button", "lmm-btn", parent, label);
        b.type = "button";
        b.addEventListener("click", onClick);
        return b;
    }

    /* Axis helper: draws left spine + optional baseline. */
    function axes(svg, box) {
        el("line", {
            x1: box.l, y1: box.t, x2: box.l, y2: box.b,
            stroke: RULE, "stroke-width": 1
        }, svg);
        el("line", {
            x1: box.l, y1: box.b, x2: box.r, y2: box.b,
            stroke: RULE, "stroke-width": 1
        }, svg);
    }

    function yAxisTicks(svg, box, scale, lo, hi, stepSize) {
        for (var v = lo; v <= hi + 1e-9; v += stepSize) {
            var y = scale(v);
            el("line", {
                x1: box.l - 4, y1: y, x2: box.l, y2: y,
                stroke: RULE, "stroke-width": 1
            }, svg);
            var t = el("text", {
                x: box.l - 8, y: y + 3.5, "text-anchor": "end",
                "font-size": 10, fill: MUTED, "class": "lmm-num"
            }, svg);
            t.textContent = v;
        }
    }

    /* ================================================================
       DATA -- one shared synthetic farm dataset
       ================================================================ */

    function buildFarms(nFarms, nPer, seed, sdFarm, sdResid, base) {
        var rng = makeRng(seed);
        var rnorm = makeNorm(rng);
        var farms = [];
        for (var j = 0; j < nFarms; j++) {
            var aj = rnorm() * sdFarm;
            var pts = [];
            var n = typeof nPer === "number" ? nPer : nPer[j];
            for (var i = 0; i < n; i++) {
                pts.push({
                    y: base + aj + rnorm() * sdResid,
                    ph: 5.4 + rng() * 1.9,
                    jitter: rng()
                });
            }
            farms.push({ id: j, alpha: aj, pts: pts });
        }
        return farms;
    }

    /* ================================================================
       APPLET 1 -- STEPPER
       ================================================================ */

    function stepper(host) {
        var W = 680, H = 400;
        var box = { l: 54, r: 545, t: 40, b: 330 };
        var ui = frame(host, {
            w: W, h: H,
            title: "Let's try building this model one step at a time.",
            aria: "We'll start with raw data and get up to the point where we have a random slopes model fit."
        });
        var svg = ui.svg;

        var LO = 20, HI = 80;
        var yS = function (v) {
            return box.b - ((v - LO) / (HI - LO)) * (box.b - box.t);
        };

        var farms = buildFarms(4, 8, 20240716, 7.5, 4.2, 50);
        var all = [];
        farms.forEach(function (f) {
            f.pts.forEach(function (p) { all.push({ y: p.y, farm: f.id, j: p.jitter }); });
        });
        var grand = mean(all.map(function (d) { return d.y; }));

        /* two x layouts: scattered (steps 0-2) and clustered by farm (step 3) */
        all.forEach(function (d, k) {
            d.xScatter = box.l + 24 + d.j * (box.r - box.l - 48);
            var slot = d.farm;
            var cw = (box.r - box.l) / 4;
            var within = (k % 8) / 7;
            d.xCluster = box.l + slot * cw + cw * 0.22 + within * cw * 0.56;
            d.x = d.xScatter;
        });

        axes(svg, box);
        yAxisTicks(svg, box, yS, 20, 80, 10);

        var yLab = el("text", {
            x: 16, y: (box.t + box.b) / 2, "font-size": 11, fill: MUTED,
            transform: "rotate(-90 16 " + ((box.t + box.b) / 2) + ")",
            "text-anchor": "middle"
        }, svg);
        yLab.textContent = "Crop yield";

        /* layers, in paint order */
        var gDensity = el("g", { opacity: 0 }, svg);
        var gResid = el("g", { opacity: 0 }, svg);
        var gGrand = el("g", { opacity: 0 }, svg);
        var gFarmLines = el("g", { opacity: 0 }, svg);
        var gPts = el("g", null, svg);
        var gFarmLabs = el("g", { opacity: 0 }, svg);

        /* grand mean line */
        el("line", {
            x1: box.l, y1: yS(grand), x2: box.r, y2: yS(grand),
            stroke: INK, "stroke-width": 1.6, "stroke-dasharray": "6 4"
        }, gGrand);
        var gLab = el("text", {
            x: box.r + 8, y: yS(grand) + 4, "font-size": 11, fill: INK, "class": "lmm-num"
        }, gGrand);
        gLab.textContent = "β₀ = " + grand.toFixed(1);

        /* residual segments */
        var residLines = all.map(function (d) {
            return el("line", {
                x1: d.x, y1: yS(d.y), x2: d.x, y2: yS(grand),
                stroke: MUTED, "stroke-width": 1, opacity: 0.45
            }, gResid);
        });

        /* rotated density on the right */
        (function () {
            var sd = Math.sqrt(mean(all.map(function (d) {
                return (d.y - grand) * (d.y - grand);
            })));
            var pts = [];
            var maxD = normPdf(grand, grand, sd);
            for (var v = LO; v <= HI; v += 0.7) {
                var d = normPdf(v, grand, sd) / maxD;
                pts.push((box.r + 46 + d * 68) + "," + yS(v));
            }
            el("polyline", {
                points: pts.join(" "),
                fill: "none", stroke: INK, "stroke-width": 1.4, opacity: 0.75
            }, gDensity);
            el("line", {
                x1: box.r + 46, y1: box.t, x2: box.r + 46, y2: box.b,
                stroke: FAINT, "stroke-width": 1
            }, gDensity);
        })();

        /* farm mean lines + labels */
        farms.forEach(function (f, j) {
            var fm = mean(f.pts.map(function (p) { return p.y; }));
            var cw = (box.r - box.l) / 4;
            var x0 = box.l + j * cw + cw * 0.12;
            var x1 = box.l + j * cw + cw * 0.88;
            el("line", {
                x1: x0, y1: yS(fm), x2: x1, y2: yS(fm),
                stroke: FARM[j], "stroke-width": 2.4
            }, gFarmLines);
            var lab = el("text", {
                x: (x0 + x1) / 2, y: box.b + 18, "text-anchor": "middle",
                "font-size": 11, fill: FARM[j]
            }, gFarmLabs);
            lab.textContent = "Farm " + "ABCD"[j];
        });

        /* points */
        var circles = all.map(function (d) {
            return el("circle", {
                cx: d.x, cy: yS(d.y), r: 4.6,
                fill: MUTED, "fill-opacity": 0.75,
                stroke: "#fff", "stroke-width": 1
            }, gPts);
        });

        /* equation display */
        var eqn = el("text", {
            x: box.l, y: 22, "font-size": 15, fill: INK, "class": "lmm-eq"
        }, svg);

        var STEPS = [
            {
                eq: "",
                cap: "To start, we can consider our measurements, which amount to only some value of yield of each plot on each farm."
            },
            {
                eq: "Yᵢ = β₀",
                cap: "If we take the most naive model possible, we can say that each plot should be described by the 'grand mean', as a testable hypothesis. In this case, our model equation is asserting that nothing else should be accounted for."
            },
            {
                eq: "Yᵢ = β₀ + εᵢ",
                cap: "Now, we have perhaps identified in our first iteration that in fact there appears to be a spread of data *around* our grand mean. What can we do about this? Well, we can stipulate in our model that each data point may depart from the grand mean in some predictable way. Following convention, we assume the distribution of departures from that grand mean follow a normal form. That is, they are described by a normal distribution."
            },
            {
                eq: "Yᵢⱼ = β₀ + αⱼ + εᵢⱼ",
                cap: "But as we know, the plots were all collected at different *farms*, and there ought to be some structure there. We can add this sorting of the structure to our model where we say that each farm may sit at it's own 'level'."
            }
        ];

        var step = 0;
        var back, next;

        function layout(target, ms) {
            var from = all.map(function (d) { return d.x; });
            var to = all.map(function (d) { return target === "cluster" ? d.xCluster : d.xScatter; });
            tween(ms, function (t) {
                for (var i = 0; i < all.length; i++) {
                    var x = lerp(from[i], to[i], t);
                    all[i].x = x;
                    setNum(circles[i], "cx", x);
                    setNum(residLines[i], "x1", x);
                    setNum(residLines[i], "x2", x);
                }
            });
        }

        function render(animate) {
            eqn.textContent = STEPS[step].eq;
            ui.caption.textContent = STEPS[step].cap;

            gGrand.setAttribute("opacity", step >= 1 ? 1 : 0);
            gResid.setAttribute("opacity", step === 2 ? 1 : 0);
            gDensity.setAttribute("opacity", step === 2 ? 1 : 0);
            gFarmLines.setAttribute("opacity", step >= 3 ? 1 : 0);
            gFarmLabs.setAttribute("opacity", step >= 3 ? 1 : 0);

            circles.forEach(function (c, i) {
                c.setAttribute("fill", step >= 3 ? FARM[all[i].farm] : MUTED);
            });

            layout(step >= 3 ? "cluster" : "scatter", animate ? 620 : 0);

            back.disabled = step === 0;
            next.disabled = step === STEPS.length - 1;
            dots.forEach(function (d, i) {
                d.className = "lmm-dot" + (i === step ? " is-on" : "");
            });
        }

        back = button(ui.controls, "Back", function () {
            if (step > 0) { step--; render(true); }
        });
        var dotWrap = htm("span", "lmm-dots", ui.controls);
        var dots = STEPS.map(function () { return htm("span", "lmm-dot", dotWrap); });
        next = button(ui.controls, "Next", function () {
            if (step < STEPS.length - 1) { step++; render(true); }
        });

        render(false);
    }

    /* ================================================================
       APPLET 2 -- DRAG
       ================================================================ */

    function drag(host) {
        var W = 680, H = 400;
        var box = { l: 54, r: 600, t: 34, b: 320 };
        var ui = frame(host, {
            w: W, h: H,
            title: "Try this yourself! Drag some of the observations around and see what happens!",
            aria: "Since our data are grouped by farm, we can see that dragging the observations of crop yield around, changes the farm means and grand mean."
        });
        var svg = ui.svg;
        svg.style.touchAction = "none";

        var LO = 20, HI = 80;
        var yS = function (v) { return box.b - ((v - LO) / (HI - LO)) * (box.b - box.t); };
        var yInv = function (py) { return LO + ((box.b - py) / (box.b - box.t)) * (HI - LO); };

        var farms = buildFarms(4, 6, 991, 7.0, 3.8, 50);
        var cw = (box.r - box.l) / 4;

        farms.forEach(function (f, j) {
            f.pts.forEach(function (p, i) {
                p.x = box.l + j * cw + cw * 0.2 + (i / 5) * cw * 0.6;
            });
        });

        axes(svg, box);
        yAxisTicks(svg, box, yS, 20, 80, 10);

        var gGrand = el("g", null, svg);
        var grandLine = el("line", {
            x1: box.l, x2: box.r, stroke: INK, "stroke-width": 1.6,
            "stroke-dasharray": "6 4"
        }, gGrand);
        var grandLab = el("text", {
            x: box.l + 4, "font-size": 11, fill: INK, "class": "lmm-num"
        }, gGrand);

        var gLines = el("g", null, svg);
        var gPts = el("g", null, svg);

        var farmLines = [], farmLabs = [], farmNames = [];
        farms.forEach(function (f, j) {
            farmLines.push(el("line", {
                x1: box.l + j * cw + cw * 0.1,
                x2: box.l + j * cw + cw * 0.9,
                stroke: FARM[j], "stroke-width": 2.6
            }, gLines));
            farmLabs.push(el("text", {
                x: box.l + j * cw + cw * 0.9 + 6, "font-size": 10.5,
                fill: FARM[j], "class": "lmm-num"
            }, gLines));
            var nm = el("text", {
                x: box.l + j * cw + cw * 0.5, y: box.b + 18,
                "text-anchor": "middle", "font-size": 11, fill: FARM[j]
            }, svg);
            nm.textContent = "Farm " + "ABCD"[j];
            farmNames.push(nm);
        });

        /* circles built once and only ever repositioned */
        var handles = [];
        farms.forEach(function (f, j) {
            f.pts.forEach(function (p, i) {
                var c = el("circle", {
                    cx: p.x, cy: yS(p.y), r: 6.5,
                    fill: FARM[j], "fill-opacity": 0.85,
                    stroke: "#fff", "stroke-width": 1.5,
                    tabindex: 0, role: "slider",
                    "aria-label": "Farm " + "ABCD"[j] + " plot " + (i + 1) + " yield"
                }, gPts);
                c.style.cursor = "ns-resize";
                c.addEventListener("mousedown", function (ev) {
                    active = { f: j, i: i }; ev.preventDefault();
                });
                c.addEventListener("touchstart", function (ev) {
                    active = { f: j, i: i }; ev.preventDefault();
                }, { passive: false });
                /* keyboard access */
                c.addEventListener("keydown", function (ev) {
                    var d = 0;
                    if (ev.key === "ArrowUp") d = 1;
                    else if (ev.key === "ArrowDown") d = -1;
                    else return;
                    ev.preventDefault();
                    p.y = Math.max(LO, Math.min(HI, p.y + d));
                    update();
                });
                handles.push({ node: c, f: j, i: i });
            });
        });

        var active = null;

        function pointerY(ev) {
            var r = svg.getBoundingClientRect();
            var cy = (ev.touches ? ev.touches[0].clientY : ev.clientY);
            return (cy - r.top) * (H / r.height);
        }

        function move(ev) {
            if (!active) return;
            var v = yInv(pointerY(ev));
            farms[active.f].pts[active.i].y = Math.max(LO, Math.min(HI, v));
            update();
            if (ev.cancelable) ev.preventDefault();
        }

        svg.addEventListener("mousemove", move);
        svg.addEventListener("touchmove", move, { passive: false });
        window.addEventListener("mouseup", function () { active = null; });
        window.addEventListener("touchend", function () { active = null; });

        function update() {
            var all = [];
            farms.forEach(function (f, j) {
                var ys = f.pts.map(function (p) { return p.y; });
                all = all.concat(ys);
                var m = mean(ys);
                farmLines[j].setAttribute("y1", yS(m));
                farmLines[j].setAttribute("y2", yS(m));
                farmLabs[j].setAttribute("y", yS(m) + 3.5);
                farmLabs[j].textContent = m.toFixed(1);
            });
            var g = mean(all);
            grandLine.setAttribute("y1", yS(g));
            grandLine.setAttribute("y2", yS(g));
            grandLab.setAttribute("y", yS(g) - 6);
            grandLab.textContent = "β₀ = " + g.toFixed(1);

            handles.forEach(function (h) {
                h.node.setAttribute("cy", yS(farms[h.f].pts[h.i].y));
            });
        }

        ui.caption.textContent =
            "Dashed line: the grand mean, β₀. Coloured lines: each farm's fitted level, β₀ + αⱼ. " +
            "Try dragging any point vertically, and note that no line ever tilts, " +
            "because the model states no relationship with anything on the horizontal axis. Think about if that remains a reasonable assumption as you may drag the values around.";

        update();
    }

    /* ================================================================
       APPLET 3 -- POOLING
       ================================================================ */

    function pooling(host) {
        var W = 680, H = 400;
        var box = { l: 60, r: 560, t: 40, b: 300 };
        var ui = frame(host, {
            w: W, h: H,
            title: "Complete, no, and partial pooling",
            aria: "Here is a comparison of complete pooling, no pooling and partial pooling estimates across farms of differing sample size."
        });
        var svg = ui.svg;

        var LO = 30, HI = 70;
        var yS = function (v) { return box.b - ((v - LO) / (HI - LO)) * (box.b - box.t); };

        /* deliberately unbalanced: shrinkage is invisible when n is equal */
        var sizes = [14, 8, 4, 2];
        var farms = buildFarms(4, sizes, 4242, 6.5, 5.0, 50);
        var cw = (box.r - box.l) / 4;

        var allY = [];
        farms.forEach(function (f) {
            f.obs = f.pts.map(function (p) { return p.y; });
            f.ybar = mean(f.obs);
            allY = allY.concat(f.obs);
        });
        var grand = mean(allY);

        /* residual variance, pooled within farm */
        var ss = 0, df = 0;
        farms.forEach(function (f) {
            f.obs.forEach(function (y) { ss += (y - f.ybar) * (y - f.ybar); });
            df += f.obs.length - 1;
        });
        var sigma2 = ss / df;

        axes(svg, box);
        yAxisTicks(svg, box, yS, 30, 70, 10);

        var gGrand = el("g", null, svg);
        el("line", {
            x1: box.l, y1: yS(grand), x2: box.r, y2: yS(grand),
            stroke: INK, "stroke-width": 1.5, "stroke-dasharray": "6 4"
        }, gGrand);
        var gl = el("text", {
            x: box.r + 8, y: yS(grand) + 4, "font-size": 11, fill: INK, "class": "lmm-num"
        }, gGrand);
        gl.textContent = "β₀";

        var gObs = el("g", null, svg);
        var gArrow = el("g", null, svg);
        var gEst = el("g", null, svg);
        var gLab = el("g", null, svg);

        farms.forEach(function (f, j) {
            var cx = box.l + j * cw + cw * 0.5;
            f.cx = cx;
            f.obs.forEach(function (y, i) {
                var n = f.obs.length;
                var spread = Math.min(cw * 0.5, n * 7);
                var x = cx + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
                el("circle", {
                    cx: x, cy: yS(y), r: 3.8,
                    fill: FARM[j], "fill-opacity": 0.5
                }, gObs);
            });
            var nm = el("text", {
                x: cx, y: box.b + 18, "text-anchor": "middle",
                "font-size": 11, fill: FARM[j]
            }, svg);
            nm.textContent = "Farm " + "ABCD"[j];
            var nn = el("text", {
                x: cx, y: box.b + 32, "text-anchor": "middle",
                "font-size": 10, fill: MUTED, "class": "lmm-num"
            }, svg);
            nn.textContent = "n = " + f.obs.length;
        });

        var estLines = farms.map(function (f, j) {
            return el("line", {
                x1: f.cx - cw * 0.34, x2: f.cx + cw * 0.34,
                stroke: FARM[j], "stroke-width": 3
            }, gEst);
        });
        var estLabs = farms.map(function (f, j) {
            return el("text", {
                x: f.cx + cw * 0.34 + 6, "font-size": 10.5,
                fill: FARM[j], "class": "lmm-num"
            }, gEst);
        });
        var arrows = farms.map(function (f, j) {
            return el("line", {
                x1: f.cx, x2: f.cx, stroke: FARM[j], "stroke-width": 1,
                "stroke-dasharray": "3 3", opacity: 0
            }, gArrow);
        });

        var mode = "partial";
        var sdAlpha = 6.5;

        var modeBtns = {};
        ["complete", "no", "partial"].forEach(function (m) {
            var label = m === "complete" ? "Complete pooling"
                : m === "no" ? "No pooling" : "Partial pooling";
            modeBtns[m] = button(ui.controls, label, function () {
                mode = m; render();
            });
        });

        var sliderWrap = htm("span", "lmm-slider", ui.controls);
        htm("label", null, sliderWrap, "σα");
        var slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0.2"; slider.max = "18"; slider.step = "0.2";
        slider.value = String(sdAlpha);
        slider.setAttribute("aria-label", "Between-farm standard deviation");
        sliderWrap.appendChild(slider);
        var sliderVal = htm("span", "lmm-num", sliderWrap, sdAlpha.toFixed(1));
        slider.addEventListener("input", function () {
            sdAlpha = parseFloat(slider.value);
            sliderVal.textContent = sdAlpha.toFixed(1);
            if (mode !== "partial") { mode = "partial"; }
            render();
        });

        function render() {
            farms.forEach(function (f, j) {
                var est;
                if (mode === "complete") est = grand;
                else if (mode === "no") est = f.ybar;
                else {
                    var n = f.obs.length;
                    var lambda = (sdAlpha * sdAlpha) / (sdAlpha * sdAlpha + sigma2 / n);
                    est = grand + lambda * (f.ybar - grand);
                }
                estLines[j].setAttribute("y1", yS(est));
                estLines[j].setAttribute("y2", yS(est));
                estLabs[j].setAttribute("y", yS(est) + 3.5);
                estLabs[j].textContent = est.toFixed(1);

                if (mode === "partial") {
                    arrows[j].setAttribute("opacity", 0.8);
                    arrows[j].setAttribute("y1", yS(f.ybar));
                    arrows[j].setAttribute("y2", yS(est));
                } else {
                    arrows[j].setAttribute("opacity", 0);
                }
            });

            for (var m in modeBtns) {
                if (Object.prototype.hasOwnProperty.call(modeBtns, m)) {
                    modeBtns[m].className = "lmm-btn" + (m === mode ? " is-on" : "");
                }
            }
            slider.disabled = (mode !== "partial");

            ui.caption.textContent =
                mode === "complete"
                    ? "Here we are giving every farm the same estimate of the grand mean."
                    : mode === "no"
                        ? "Every farm is estimated from its own observations alone. Farm D, with two plots, is estimated as 'confidently' as Farm A is with fourteen, which should give us pause."
                        : "Here, each farm's estimate is pulled from its own mean (dashed) toward the grand mean. The pull is strongest where the number of data points is fewest, so therefore Farm D moves furthest, and Farm A barely moves at all. If we lower σα, we can increase the pull, or we could raise it to release the estimates toward their own means.";
        }

        render();
    }

    /* ================================================================
       APPLET 4 -- SLOPES
       ================================================================ */

    function slopes(host) {
        var W = 680, H = 410;
        var box = { l: 58, r: 600, t: 36, b: 320 };
        var ui = frame(host, {
            w: W, h: H,
            title: "A nice illustration of moving through our options of 1) flat lines to 2) parallel lines to 3) fanning lines",
            aria: "This is showing crop yield against soil pH under three model structures: 1) intercept only, 2) random intercepts with a common slope, and 3) random intercepts with random slopes."
        });
        var svg = ui.svg;

        var XLO = 5.2, XHI = 7.6, YLO = 25, YHI = 80;
        var xS = function (v) { return box.l + ((v - XLO) / (XHI - XLO)) * (box.r - box.l); };
        var yS = function (v) { return box.b - ((v - YLO) / (YHI - YLO)) * (box.b - box.t); };

        /* build farms with genuinely differing slopes */
        var rng = makeRng(60321);
        var rnorm = makeNorm(rng);
        var trueSlopes = [14.5, 9.0, 3.0, -2.5];
        var farms = trueSlopes.map(function (s, j) {
            var a0 = [-6, 4, 9, -3][j];
            var pts = [];
            for (var i = 0; i < 9; i++) {
                var ph = XLO + 0.15 + rng() * (XHI - XLO - 0.3);
                pts.push({ ph: ph, y: 50 + a0 + s * (ph - 6.4) + rnorm() * 3.4 });
            }
            return { id: j, pts: pts, slope: s };
        });

        axes(svg, box);
        yAxisTicks(svg, box, yS, 30, 80, 10);
        for (var v = 5.5; v <= 7.5; v += 0.5) {
            el("line", { x1: xS(v), y1: box.b, x2: xS(v), y2: box.b + 4, stroke: RULE }, svg);
            var t = el("text", {
                x: xS(v), y: box.b + 16, "text-anchor": "middle",
                "font-size": 10, fill: MUTED, "class": "lmm-num"
            }, svg);
            t.textContent = v.toFixed(1);
        }
        var xl = el("text", {
            x: (box.l + box.r) / 2, y: box.b + 34, "text-anchor": "middle",
            "font-size": 11, fill: MUTED
        }, svg);
        xl.textContent = "Soil pH";
        var yl = el("text", {
            x: 16, y: (box.t + box.b) / 2, "font-size": 11, fill: MUTED,
            transform: "rotate(-90 16 " + ((box.t + box.b) / 2) + ")",
            "text-anchor": "middle"
        }, svg);
        yl.textContent = "Crop yield";

        /* --- illustrative fits (not lmer output; see caption) --- */
        var allPts = [];
        farms.forEach(function (f) {
            f.ybar = mean(f.pts.map(function (p) { return p.y; }));
            f.xbar = mean(f.pts.map(function (p) { return p.ph; }));
            allPts = allPts.concat(f.pts);
        });
        var grandY = mean(allPts.map(function (p) { return p.y; }));

        /* pooled within-farm slope */
        var num = 0, den = 0;
        farms.forEach(function (f) {
            f.pts.forEach(function (p) {
                num += (p.ph - f.xbar) * (p.y - f.ybar);
                den += (p.ph - f.xbar) * (p.ph - f.xbar);
            });
        });
        var betaCommon = num / den;

        /* per-farm slopes, lightly shrunk toward the common slope */
        farms.forEach(function (f) {
            var n = 0, d = 0;
            f.pts.forEach(function (p) {
                n += (p.ph - f.xbar) * (p.y - f.ybar);
                d += (p.ph - f.xbar) * (p.ph - f.xbar);
            });
            var raw = n / d;
            f.slopeHat = betaCommon + 0.85 * (raw - betaCommon);
        });

        var gLines = el("g", null, svg);
        var gPts = el("g", null, svg);

        farms.forEach(function (f, j) {
            f.pts.forEach(function (p) {
                el("circle", {
                    cx: xS(p.ph), cy: yS(p.y), r: 4,
                    fill: FARM[j], "fill-opacity": 0.65
                }, gPts);
            });
        });

        var lines = farms.map(function (f, j) {
            return el("line", { stroke: FARM[j], "stroke-width": 2.4 }, gLines);
        });

        var eqn = el("text", {
            x: box.l, y: 22, "font-size": 15, fill: INK, "class": "lmm-eq"
        }, svg);

        var MODES = {
            flat: {
                label: "Intercept only",
                eq: "Yᵢⱼ = β₀ + αⱼ + εᵢⱼ",
                cap: "No relationship with soil pH is stated.",
                line: function (f) { return { a: f.ybar, b: 0 }; }
            },
            parallel: {
                label: "Common slope",
                eq: "Yᵢⱼ = β₀ + β₁xᵢⱼ + αⱼ + εᵢⱼ",
                cap: "Now we have pH entering the model, so each line tilts by the same amount. This means we see the intercepts vary from farm to farm, but the slope β₁ is a single population-level quantity.",
                line: function (f) { return { a: f.ybar - betaCommon * f.xbar, b: betaCommon }; }
            },
            varying: {
                label: "Varying slopes",
                eq: "Yᵢⱼ = β₀ + β₁xᵢⱼ + αⱼ + bⱼxᵢⱼ + εᵢⱼ",
                cap: "Each farm is now permitted its own response to pH. The lines of course no longer are parallel, and the model gains a second variance component, σ²b, which describes how much that response varies from farm to farm.",
                line: function (f) { return { a: f.ybar - f.slopeHat * f.xbar, b: f.slopeHat }; }
            }
        };

        var order = ["flat", "parallel", "varying"];
        var mode = "flat";
        var current = farms.map(function (f) { return { a: f.ybar, b: 0 }; });

        var btns = {};
        order.forEach(function (m) {
            btns[m] = button(ui.controls, MODES[m].label, function () { setMode(m); });
        });

        function draw(coefs) {
            coefs.forEach(function (c, j) {
                lines[j].setAttribute("x1", xS(XLO + 0.1));
                lines[j].setAttribute("y1", yS(c.a + c.b * (XLO + 0.1)));
                lines[j].setAttribute("x2", xS(XHI - 0.1));
                lines[j].setAttribute("y2", yS(c.a + c.b * (XHI - 0.1)));
            });
        }

        function setMode(m) {
            mode = m;
            var from = current.map(function (c) { return { a: c.a, b: c.b }; });
            var to = farms.map(MODES[m].line);
            tween(520, function (t) {
                var now = from.map(function (c, j) {
                    return { a: lerp(c.a, to[j].a, t), b: lerp(c.b, to[j].b, t) };
                });
                draw(now);
                current = now;
            });
            eqn.textContent = MODES[m].eq;
            ui.caption.textContent = MODES[m].cap +
                "  (Lines here are illustrative least-squares fits mostly for demonstration, " +
                "the estimates you would obtain from lme4 differ slightly because of shrinkage.)";
            order.forEach(function (k) {
                btns[k].className = "lmm-btn" + (k === mode ? " is-on" : "");
            });
        }

        setMode("flat");
    }

    /* ================================================================
       MOUNT
       ================================================================ */

    var REGISTRY = {
        stepper: stepper,
        drag: drag,
        pooling: pooling,
        slopes: slopes
    };

    function init() {
        var nodes = document.querySelectorAll(".lmm-applet[data-applet]");
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.getAttribute("data-mounted") === "1") continue;
            var fn = REGISTRY[node.getAttribute("data-applet")];
            if (!fn) continue;
            try {
                fn(node);
                node.setAttribute("data-mounted", "1");
            } catch (err) {
                node.textContent = "This figure could not be drawn.";
                if (window.console) console.error("lmm-applet failed:", err);
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();