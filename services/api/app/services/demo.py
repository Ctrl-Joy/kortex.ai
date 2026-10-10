"""Deterministic, clearly-labelled demo scenarios A–H.

Each scenario runs step by step in a background thread. Every step goes
through the same service layer the REST API uses (pipeline, resolutions,
checkout), commits to the real database and broadcasts over WebSockets, so the
dashboards update live. All injected scans and camera/sensor events carry
source=SIMULATED and is_simulated=True.

Steps marked `human` are left for the presenter to perform in the UI (e.g. a
staff member dismissing a false positive) unless `auto_complete` is set.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ids import new_id
from app.core.time import utcnow
from app.models import Discrepancy, Product
from app.models.enums import (
    ActorType,
    DiscrepancyKind,
    EventSource,
    VisionEventType,
)
from app.services import audit, cart, checkout, discrepancies, pipeline, resolutions, sessions
from app.services.audit import Actor
from app.services.pipeline import VisionInput
from app.services.policy_access import current_policy
from app.websocket.hub import hub, make_message

log = logging.getLogger("kortex.demo")


class StepFailed(Exception):
    pass


@dataclass
class Ctx:
    run: DemoRun
    db: Session
    fast: bool

    @property
    def sim(self) -> Actor:
        return Actor(ActorType.SIMULATOR, f"scenario-{self.run.scenario}")

    @property
    def sim_customer(self) -> Actor:
        return Actor(ActorType.SIMULATOR, f"simulated-customer-{self.run.scenario}")

    @property
    def demo_staff(self) -> Actor:
        return Actor(ActorType.STAFF, "demo-autoplay")

    def product(self, sku: str) -> Product:
        p = self.db.scalar(select(Product).where(Product.sku == sku))
        if p is None:
            raise StepFailed(f"Demo product {sku} missing — run the seed script")
        return p

    def session(self):
        return sessions.get_session(self.db, self.run.session_id or "")

    # -- actions ----------------------------------------------------------
    def start(self) -> str:
        s, token = sessions.create_session(self.db, actor=self.sim, is_demo=True, scenario_code=self.run.scenario)
        self.run.session_id = s.id
        self.run.customer_token = token
        return f"Session {s.id} started; camera zone SHELF-A1 now monitors it."

    def scan(self, sku: str) -> str:
        p = self.product(sku)
        out = pipeline.process_scan(
            self.db,
            self.session(),
            code=p.barcode,
            method="CAMERA_BARCODE",
            actor=self.sim,
            source=EventSource.SIMULATED,
            is_simulated=True,
        )
        return f"[SIMULATED scan] {p.name} — ₹{p.price_paise / 100:.0f} ({out.status.lower().replace('_', ' ')})."

    def pickup(
        self,
        sku: str | None,
        conf: float,
        *,
        frames: int = 10,
        track: str | None = None,
        reason: str | None = None,
        contradictory: bool = False,
        class_label: str | None = None,
        offset_s: float = 0,
    ) -> str:
        p = self.product(sku) if sku else None
        out = pipeline.ingest_vision_event(
            self.db,
            VisionInput(
                external_event_id=new_id("SIMVE", 12),
                zone_id="SHELF-A1",
                session_id=self.run.session_id,
                event_type=VisionEventType.PICKUP,
                occurred_at=utcnow() + timedelta(seconds=offset_s),
                source=EventSource.SIMULATED,
                is_simulated=True,
                product_id=p.id if p else None,
                class_label=class_label,
                model_confidence=conf,
                track_frames=frames,
                track_id=track or new_id("trk", 4).lower(),
                zone_status="EXITED_ZONE",
                uncertainty_reason=reason,
                contradictory=contradictory,
            ),
            actor=self.sim,
        )
        what = p.name if p else (class_label or "unidentified object")
        return (
            f"[SIMULATED camera] candidate pickup of {what} (model confidence {conf:.2f}) → {out.event.state.lower()}."
        )

    def give_back(self, sku: str, conf: float, *, track: str) -> str:
        p = self.product(sku)
        out = pipeline.ingest_vision_event(
            self.db,
            VisionInput(
                external_event_id=new_id("SIMVE", 12),
                zone_id="SHELF-A1",
                session_id=self.run.session_id,
                event_type=VisionEventType.RETURN,
                occurred_at=utcnow(),
                source=EventSource.SIMULATED,
                is_simulated=True,
                product_id=p.id,
                model_confidence=conf,
                track_frames=8,
                track_id=track,
                zone_status="ENTERED_ZONE",
            ),
            actor=self.sim,
        )
        return f"[SIMULATED camera] candidate return of {p.name} → {out.event.state.lower().replace('_', ' ')}."

    def sensor(self, delta: int) -> str:
        pipeline.ingest_sensor_event(
            self.db,
            external_event_id=new_id("SIMSNS", 12),
            zone_id="SHELF-A1",
            delta_grams=delta,
            occurred_at=utcnow(),
            source=EventSource.SENSOR_SIMULATED,
            is_simulated=True,
            calibration={"device": "simulated-hx711", "scale_factor": 1.0, "tare_g": 0},
            session_id=self.run.session_id,
            actor=Actor(ActorType.SENSOR, "simulated-shelf-scale"),
        )
        return f"[SIMULATED sensor] shelf weight change {delta:+d} g."

    def wait_grace(self) -> str:
        policy = current_policy(self.db)
        if self.fast:
            n = pipeline.finalize_pending(self.db, session_id=self.run.session_id, force=True)
            audit.record(
                self.db,
                actor=self.sim,
                event_type="DEMO_FAST_FORWARD",
                summary=f"Demo fast-forward: grace window ({policy.scan_grace_s:.0f}s) skipped; {n} observation(s) finalised.",
                session_id=self.run.session_id,
                is_simulated=True,
            )
            return f"Fast-forward: finalised {n} pending observation(s) without waiting {policy.scan_grace_s:.0f}s."
        self.db.commit()
        deadline = time.monotonic() + policy.scan_grace_s + 30
        self.run.note(f"Waiting up to {policy.scan_grace_s:.0f}s grace window for a matching scan…")
        while time.monotonic() < deadline:
            self.db.expire_all()
            if pipeline.pending_count(self.db, self.run.session_id or "") == 0:
                break
            time.sleep(0.5)
        else:
            pipeline.finalize_pending(self.db, session_id=self.run.session_id, force=True)
        return (
            f"Grace window ({policy.scan_grace_s:.0f}s) elapsed with no matching scan; reconciliation engine decided."
        )

    def open_items(self, kind: DiscrepancyKind | None = None) -> list[Discrepancy]:
        items = discrepancies.open_for_session(self.db, self.run.session_id or "")
        return [d for d in items if kind is None or d.kind == kind]

    def report(self) -> str:
        items = discrepancies.open_for_session(self.db, self.run.session_id or "")
        lines = cart.cart_lines(self.db, self.run.session_id or "")
        count, subtotal = cart.totals(lines)
        if not items:
            return f"No open alerts. Cart: {count} item(s), ₹{subtotal / 100:.2f}."
        desc = ", ".join(
            f"{d.id} {d.kind.replace('_', ' ').lower()} ({d.state.replace('_', ' ').lower()})" for d in items
        )
        return f"Open: {desc}. Cart: {count} item(s), ₹{subtotal / 100:.2f} (unchanged until confirmed)."

    def customer(self, kind: DiscrepancyKind, option: str) -> str:
        items = self.open_items(kind)
        if not items:
            raise StepFailed(f"No open {kind} alert to respond to")
        d = items[0]
        resolutions.customer_action(self.db, self.session(), d, option, actor=self.sim_customer)
        return f"[SIMULATED customer] chose {option.replace('_', ' ').lower()} on {d.id} → {d.state.replace('_', ' ').lower()}."

    def staff(self, kind: DiscrepancyKind, action: str, reason: str, correction: str = "NONE") -> str:
        items = self.open_items(kind)
        if not items:
            raise StepFailed(f"No open {kind} alert for staff")
        d = items[0]
        resolutions.staff_action(
            self.db, self.session(), d, action=action, reason=reason, correction=correction, actor=self.demo_staff
        )
        return f"[AUTOPLAY staff] {action.lower()} {d.id}: “{reason}”."

    def try_checkout(self, expect_blocked: bool = False) -> str:
        try:
            record, _ = checkout.authorize(self.db, self.session(), actor=self.sim_customer)
        except checkout.CheckoutDenied as exc:
            blockers = "; ".join(b["message"] for b in exc.details.get("blockers", []))
            if not expect_blocked:
                raise StepFailed(f"Checkout unexpectedly blocked: {blockers}") from exc
            return f"Backend BLOCKED checkout (HTTP 409): {blockers}"
        if expect_blocked:
            raise StepFailed("Checkout was expected to be blocked but was authorized")
        return (
            f"Checkout AUTHORIZED ({record.id}, SIMULATED payment): {record.item_count} item(s), "
            f"total ₹{record.total_paise / 100:.2f} from catalogue prices."
        )

    def exit(self) -> str:
        record = checkout.confirm_exit(self.db, self.session(), actor=self.sim_customer)
        return f"[SIMULATED] exit gate confirmed with code {record.exit_code}."


@dataclass
class Step:
    label: str
    fn: Callable[[Ctx], str]
    human: bool = False


@dataclass
class Scenario:
    code: str
    title: str
    summary: str
    steps: list[Step]
    hint: str


@dataclass
class DemoRun:
    id: str
    scenario: str
    title: str
    fast: bool
    auto_complete: bool
    step_delay_s: float
    status: str = "RUNNING"
    session_id: str | None = None
    customer_token: str | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    hint: str = ""
    started_at: datetime = field(default_factory=utcnow)
    finished_at: datetime | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def note(self, text: str) -> None:
        with self.lock:
            running = next((st for st in self.steps if st["status"] == "RUNNING"), None)
            if running is not None:
                running["detail"] = text
        _publish(self)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.id,
            "scenario": self.scenario,
            "title": self.title,
            "status": self.status,
            "session_id": self.session_id,
            "customer_link": (
                f"/shop?session={self.session_id}&token={self.customer_token}"
                if self.session_id and self.customer_token
                else None
            ),
            "steps": [dict(s) for s in self.steps],
            "hint": self.hint,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


K = DiscrepancyKind

SCENARIOS: dict[str, Scenario] = {
    "A": Scenario(
        "A",
        "Normal purchase",
        "Correct scan + matching camera pickup; cart stays valid; checkout proceeds.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Kortex Cola", lambda c: c.scan("BEV-COLA-500")),
            Step("Shelf scale reports a removal", lambda c: c.sensor(-538)),
            Step("Camera: candidate pickup of Cola", lambda c: c.pickup("BEV-COLA-500", 0.91, frames=14)),
            Step("Reconciliation result", lambda c: c.report()),
            Step("Customer checks out", lambda c: c.try_checkout(), human=True),
            Step("Exit gate", lambda c: c.exit(), human=True),
        ],
        "Open the customer link and tap Checkout. Eligibility is decided by the backend.",
    ),
    "B": Scenario(
        "B",
        "Possible missed scan",
        "A candidate removal appears with no associated scan; KORTEX asks for verification.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Bananas", lambda c: c.scan("FRT-BANANA-6")),
            Step("Camera: pickup of Bananas (matches scan)", lambda c: c.pickup("FRT-BANANA-6", 0.88, frames=12)),
            Step("Shelf scale reports a removal", lambda c: c.sensor(-104)),
            Step("Camera: candidate pickup of Chocolate", lambda c: c.pickup("CNF-CHOC-100", 0.89, frames=11)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Reconciliation result", lambda c: c.report()),
            Step(
                "Customer adds the item from the alert", lambda c: c.customer(K.MISSED_SCAN, "ADD_TO_CART"), human=True
            ),
        ],
        "In the customer app, the alert offers ‘Add to cart’, ‘I put it back’ or ‘Ask staff’.",
    ),
    "C": Scenario(
        "C",
        "Product mismatch",
        "Scanned Cola ₹40, camera observes Chocolate ₹60; no silent replacement.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Cola (₹40)", lambda c: c.scan("BEV-COLA-500")),
            Step("Shelf scale reports a removal", lambda c: c.sensor(-103)),
            Step("Camera: candidate pickup of Chocolate (₹60)", lambda c: c.pickup("CNF-CHOC-100", 0.86, frames=9)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Reconciliation result (cart unchanged)", lambda c: c.report()),
            Step("Customer confirms the correction", lambda c: c.customer(K.WRONG_PRODUCT, "REPLACE_ITEM"), human=True),
            Step("Corrected cart", lambda c: c.report(), human=True),
        ],
        "The customer app asks which item they have. The cart changes only after confirmation.",
    ),
    "D": Scenario(
        "D",
        "Pickup then return",
        "A candidate pickup followed by a return produces no unresolved-removal alert.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Coffee Mug", lambda c: c.scan("HOM-MUG-350")),
            Step("Camera: pickup of Mug (matches scan)", lambda c: c.pickup("HOM-MUG-350", 0.90, frames=15)),
            Step(
                "Camera: candidate pickup of Notebook",
                lambda c: c.pickup("STN-NOTE-A5", 0.84, frames=10, track="trk-note-1"),
            ),
            Step("Camera: Notebook returned to shelf", lambda c: c.give_back("STN-NOTE-A5", 0.82, track="trk-note-1")),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Reconciliation result", lambda c: c.report()),
        ],
        "Open the session in Shopping Sessions: the pickup is marked RETURNED and logged as an informational record.",
    ),
    "E": Scenario(
        "E",
        "Uncertain vision",
        "Low-confidence and contradictory observations require verification, not accusation.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Cola", lambda c: c.scan("BEV-COLA-500")),
            Step("Camera: pickup of Cola (matches scan)", lambda c: c.pickup("BEV-COLA-500", 0.90, frames=12)),
            Step(
                "Camera: low-confidence pickup (occluded)",
                lambda c: c.pickup(
                    "CNF-CHOC-100", 0.41, frames=3, reason="Hand occludes most of the object", offset_s=-8
                ),
            ),
            Step("Shelf scale: no weight change", lambda c: c.sensor(2)),
            Step("Camera: pickup of Mug contradicted by scale", lambda c: c.pickup("HOM-MUG-350", 0.81, frames=8)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Reconciliation result", lambda c: c.report()),
            Step(
                "Customer confirms basket (uncertain item)",
                lambda c: c.customer(K.UNCERTAIN_OBSERVATION, "CONFIRM_NOTHING_EXTRA"),
                human=True,
            ),
            Step(
                "Staff reviews conflicting evidence",
                lambda c: c.staff(
                    K.CONFLICTING_EVIDENCE,
                    "DISMISS",
                    "Shelf count verified: mug still on shelf; camera false positive.",
                ),
                human=True,
            ),
        ],
        "The uncertain item asks the customer to check; the contradictory one goes to staff in Discrepancies.",
    ),
    "F": Scenario(
        "F",
        "False positive dismissed",
        "Staff documents why an alert is a false positive; the cart is not altered.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Bananas", lambda c: c.scan("FRT-BANANA-6")),
            Step("Camera: candidate pickup of Cola", lambda c: c.pickup("BEV-COLA-500", 0.78, frames=6)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Reconciliation result", lambda c: c.report()),
            Step("Customer: ‘My scan is correct’", lambda c: c.customer(K.WRONG_PRODUCT, "KEEP_SCANNED")),
            Step(
                "Staff dismisses as false positive",
                lambda c: c.staff(
                    K.WRONG_PRODUCT, "DISMISS", "Reviewed shelf: Cola count unchanged; shopper only has bananas."
                ),
                human=True,
            ),
            Step("Cart unchanged", lambda c: c.report(), human=True),
        ],
        "Go to Discrepancies, open the AWAITING STAFF alert and choose ‘Dismiss false positive’ with a reason.",
    ),
    "G": Scenario(
        "G",
        "Checkout blocked",
        "An unresolved blocking discrepancy prevents checkout in the backend.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Chocolate", lambda c: c.scan("CNF-CHOC-100")),
            Step("Camera: pickup of Chocolate (matches scan)", lambda c: c.pickup("CNF-CHOC-100", 0.90, frames=12)),
            Step("Shelf scale reports a removal", lambda c: c.sensor(-540)),
            Step("Camera: candidate pickup of Cola", lambda c: c.pickup("BEV-COLA-500", 0.90, frames=12)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Customer attempts checkout", lambda c: c.try_checkout(expect_blocked=True)),
            Step(
                "Staff verifies and corrects the cart",
                lambda c: c.staff(
                    K.MISSED_SCAN, "RESOLVE", "Basket checked at exit: Cola present, added to cart.", "ADD_OBSERVED"
                ),
                human=True,
            ),
            Step("Checkout retried", lambda c: c.try_checkout(), human=True),
        ],
        "Try Checkout in the customer app: the backend returns HTTP 409 with actionable reasons.",
    ),
    "H": Scenario(
        "H",
        "Successful checkout",
        "Required checks resolved, itemized bill generated, authorization recorded.",
        [
            Step("Start shopping session", lambda c: c.start()),
            Step("Customer scans Cola (₹40)", lambda c: c.scan("BEV-COLA-500")),
            Step("Camera: candidate pickup of Chocolate (₹60)", lambda c: c.pickup("CNF-CHOC-100", 0.87, frames=10)),
            Step("Wait for the scan grace window", lambda c: c.wait_grace()),
            Step("Customer confirms the correction", lambda c: c.customer(K.WRONG_PRODUCT, "REPLACE_ITEM")),
            Step("Checkout authorized", lambda c: c.try_checkout()),
            Step("Exit gate", lambda c: c.exit()),
        ],
        "Open the session to see the itemized bill (₹60 from catalogue prices) and the full audit trail.",
    ),
}


_RUNS: OrderedDict[str, DemoRun] = OrderedDict()
_RUNS_LOCK = threading.Lock()


def _publish(run: DemoRun) -> None:
    hub.publish(make_message("demo.progress", session_id=run.session_id, data={"run_id": run.id, "status": run.status}))


def list_runs() -> list[DemoRun]:
    with _RUNS_LOCK:
        return list(reversed(_RUNS.values()))


def get_run(run_id: str) -> DemoRun | None:
    return _RUNS.get(run_id)


def start_run(
    scenario: str,
    *,
    session_factory: Callable[[], Session],
    fast: bool,
    auto_complete: bool,
    step_delay_s: float,
    background: bool = True,
) -> DemoRun:
    sc = SCENARIOS[scenario]
    run = DemoRun(
        id=new_id("RUN", 6),
        scenario=sc.code,
        title=sc.title,
        fast=fast,
        auto_complete=auto_complete,
        step_delay_s=step_delay_s,
        hint=sc.hint,
    )
    run.steps = [
        {"label": st.label, "status": "PENDING", "detail": "", "human": st.human, "at": None} for st in sc.steps
    ]
    with _RUNS_LOCK:
        _RUNS[run.id] = run
        while len(_RUNS) > 50:
            _RUNS.popitem(last=False)
    if background:
        threading.Thread(target=_execute, args=(run, sc, session_factory), daemon=True, name=f"demo-{run.id}").start()
    else:
        _execute(run, sc, session_factory)
    return run


def resume_run(run_id: str, *, session_factory: Callable[[], Session], background: bool = True) -> DemoRun | None:
    """Autoplay the remaining presenter steps of a paused run."""
    run = get_run(run_id)
    if run is None or run.status != "WAITING_FOR_PRESENTER":
        return run
    sc = SCENARIOS[run.scenario]
    start = next((i for i, st in enumerate(run.steps) if st["status"] != "DONE"), len(run.steps))
    with run.lock:
        run.auto_complete = True
        run.status = "RUNNING"
        for st in run.steps[start:]:
            st["status"] = "PENDING"
    if background:
        threading.Thread(target=_execute, args=(run, sc, session_factory, start), daemon=True).start()
    else:
        _execute(run, sc, session_factory, start)
    return run


def _execute(run: DemoRun, sc: Scenario, session_factory: Callable[[], Session], start: int = 0) -> None:
    for i, step in enumerate(sc.steps):
        if i < start:
            continue
        if step.human and not run.auto_complete:
            with run.lock:
                for rest in run.steps[i:]:
                    rest["status"] = "AWAITING_PRESENTER" if rest is run.steps[i] else "MANUAL"
                run.status = "WAITING_FOR_PRESENTER"
            _publish(run)
            return
        with run.lock:
            run.steps[i]["status"] = "RUNNING"
            run.steps[i]["at"] = utcnow().isoformat()
        _publish(run)
        db = session_factory()
        try:
            ctx = Ctx(run=run, db=db, fast=run.fast)
            detail = step.fn(ctx)
            db.commit()
            with run.lock:
                run.steps[i]["status"] = "DONE"
                run.steps[i]["detail"] = detail
        except Exception as exc:  # report and stop the scenario
            db.rollback()
            log.exception("demo step failed")
            with run.lock:
                run.steps[i]["status"] = "FAILED"
                run.steps[i]["detail"] = str(exc)
                run.status = "FAILED"
                run.finished_at = utcnow()
            _publish(run)
            return
        finally:
            db.close()
        _publish(run)
        if run.step_delay_s and i < len(sc.steps) - 1:
            time.sleep(run.step_delay_s)
    with run.lock:
        run.status = "COMPLETED"
        run.finished_at = utcnow()
    _publish(run)
