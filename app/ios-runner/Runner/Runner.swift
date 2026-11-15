// Serveur HTTP qui tourne dans un test XCUITest sans fin.
//   GET  /tree?bundle=…           arbre des composants (type, identifiant, libellé, cadre en points)
//   POST /tap?bundle=…&x=&y=      toucher
//   POST /swipe?bundle=…&x=&y=&x2=&y2=&d=   glisser
//   POST /type?bundle=…           texte (corps brut) dans le champ actif
// Les requêtes sont traitées sur le fil principal, comme l'exige XCUITest.
import XCTest
import Network

private let TYPES = ["any", "other", "application", "group", "window", "sheet", "drawer", "alert", "dialog", "button",
  "radioButton", "radioGroup", "checkBox", "disclosureTriangle", "popUpButton", "comboBox", "menuButton", "toolbarButton",
  "popover", "keyboard", "key", "navigationBar", "tabBar", "tabGroup", "toolbar", "statusBar", "table", "tableRow",
  "tableColumn", "outline", "outlineRow", "browser", "collectionView", "slider", "pageIndicator", "progressIndicator",
  "activityIndicator", "segmentedControl", "picker", "pickerWheel", "switch", "toggle", "link", "image", "icon",
  "searchField", "scrollView", "scrollBar", "staticText", "textField", "secureTextField", "datePicker", "textView",
  "menu", "menuItem", "menuBar", "menuBarItem", "map", "webView", "incrementArrow", "decrementArrow", "timeline",
  "ratingIndicator", "valueIndicator", "splitGroup", "splitter", "relevanceIndicator", "colorWell", "helpTag", "matte",
  "dockItem", "ruler", "rulerMarker", "grid", "levelIndicator", "cell", "layoutArea", "layoutItem", "handle", "stepper",
  "tab", "touchBar", "statusItem"]

final class Runner: XCTestCase {
  var apps: [String: XCUIApplication] = [:]

  func app(_ bundle: String) -> XCUIApplication {
    if let a = apps[bundle] { return a }
    let a = XCUIApplication(bundleIdentifier: bundle)
    apps[bundle] = a
    return a
  }

  func testServe() throws {
    let port = UInt16(ProcessInfo.processInfo.environment["BRIDGE_PORT"] ?? "") ?? 7830
    let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
    listener.newConnectionHandler = { [weak self] c in
      c.start(queue: .main)
      self?.receive(c, Data())
    }
    listener.start(queue: .main)
    if let b = ProcessInfo.processInfo.environment["BRIDGE_APP"], !b.isEmpty { app(b).activate() }
    print("BRIDGE_READY \(port)")
    while true { RunLoop.current.run(until: Date(timeIntervalSinceNow: 1)) }
  }

  // Lit une requête HTTP complète (en-têtes + corps), puis répond et ferme.
  func receive(_ c: NWConnection, _ acc: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, done, err in
      guard let self else { return }
      var buf = acc
      if let data { buf.append(data) }
      if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: buf[..<end.lowerBound], as: UTF8.self)
        let len = head.split(separator: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
          .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
        let body = buf[end.upperBound...]
        if body.count >= len {
          let line = head.split(separator: "\r\n").first.map(String.init) ?? ""
          let parts = line.split(separator: " ")
          let (code, out) = self.handle(parts.count > 1 ? String(parts[1]) : "/", Data(body.prefix(len)))
          let res = "HTTP/1.1 \(code) OK\r\ncontent-type: application/json\r\ncontent-length: \(out.count)\r\nconnection: close\r\n\r\n"
          c.send(content: Data(res.utf8) + out, completion: .contentProcessed { _ in c.cancel() })
          return
        }
      }
      if done || err != nil { c.cancel(); return }
      self.receive(c, buf)
    }
  }

  func handle(_ target: String, _ body: Data) -> (Int, Data) {
    let u = URLComponents(string: target)
    let q = Dictionary((u?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    let num = { (k: String) in CGFloat(Double(q[k] ?? "") ?? 0) }
    guard let bundle = q["bundle"], !bundle.isEmpty else { return (400, json(["error": "bundle manquant"])) }
    let a = app(bundle)
    do {
      switch u?.path ?? "" {
      case "/tree":
        guard a.state == .runningForeground else { return (409, json(["error": "app pas au premier plan", "state": a.state.rawValue])) }
        var nodes: [[String: Any]] = []
        flatten(try a.snapshot(), parent: -1, depth: 0, into: &nodes)
        return (200, json(["nodes": nodes]))
      case "/tap":
        point(a, num("x"), num("y")).tap()
      case "/swipe":
        point(a, num("x"), num("y")).press(forDuration: 0.02, thenDragTo: point(a, num("x2"), num("y2")),
          withVelocity: XCUIGestureVelocity(max(200, num("v"))), thenHoldForDuration: 0)
      case "/type":
        a.typeText(String(decoding: body, as: UTF8.self))
      default:
        return (404, json(["error": "inconnu"]))
      }
      return (200, json(["ok": true]))
    } catch {
      return (500, json(["error": "\(error)"]))
    }
  }

  func point(_ a: XCUIApplication, _ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
    a.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
  }

  func flatten(_ s: XCUIElementSnapshot, parent: Int, depth: Int, into nodes: inout [[String: Any]]) {
    let f = s.frame
    let i = nodes.count
    var n: [String: Any] = ["i": i, "p": parent, "d": depth,
      "t": TYPES.indices.contains(Int(s.elementType.rawValue)) ? TYPES[Int(s.elementType.rawValue)] : "element",
      "f": [f.origin.x, f.origin.y, f.size.width, f.size.height].map { ($0 * 10).rounded() / 10 }]
    if !s.identifier.isEmpty { n["id"] = s.identifier }
    if !s.label.isEmpty { n["l"] = s.label }
    if let v = s.value { let v = "\(v)"; if !v.isEmpty { n["v"] = v } }
    if let p = s.placeholderValue, !p.isEmpty { n["ph"] = p }
    if s.isSelected { n["sel"] = true }
    if !s.isEnabled { n["off"] = true }
    nodes.append(n)
    for c in s.children { flatten(c, parent: i, depth: depth + 1, into: &nodes) }
  }

  func json(_ o: Any) -> Data { (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{}".utf8) }
}
