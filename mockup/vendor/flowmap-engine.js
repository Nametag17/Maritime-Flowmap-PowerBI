var FlowEngine = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // mockup/tools/engine-entry.ts
  var engine_entry_exports = {};
  __export(engine_entry_exports, {
    arc: () => arc,
    layout: () => layout
  });

  // code/node_modules/d3-array/src/ascending.js
  function ascending_default(a, b) {
    return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
  }

  // code/node_modules/d3-array/src/bisector.js
  function bisector_default(compare) {
    if (compare.length === 1) compare = ascendingComparator(compare);
    return {
      left: function(a, x, lo, hi) {
        if (lo == null) lo = 0;
        if (hi == null) hi = a.length;
        while (lo < hi) {
          var mid = lo + hi >>> 1;
          if (compare(a[mid], x) < 0) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
      right: function(a, x, lo, hi) {
        if (lo == null) lo = 0;
        if (hi == null) hi = a.length;
        while (lo < hi) {
          var mid = lo + hi >>> 1;
          if (compare(a[mid], x) > 0) hi = mid;
          else lo = mid + 1;
        }
        return lo;
      }
    };
  }
  function ascendingComparator(f) {
    return function(d, x) {
      return ascending_default(f(d), x);
    };
  }

  // code/node_modules/d3-array/src/bisect.js
  var ascendingBisect = bisector_default(ascending_default);
  var bisectRight = ascendingBisect.right;
  var bisectLeft = ascendingBisect.left;

  // code/node_modules/d3-array/src/extent.js
  function extent_default(values, valueof) {
    var n = values.length, i = -1, value, min, max;
    if (valueof == null) {
      while (++i < n) {
        if ((value = values[i]) != null && value >= value) {
          min = max = value;
          while (++i < n) {
            if ((value = values[i]) != null) {
              if (min > value) min = value;
              if (max < value) max = value;
            }
          }
        }
      }
    } else {
      while (++i < n) {
        if ((value = valueof(values[i], i, values)) != null && value >= value) {
          min = max = value;
          while (++i < n) {
            if ((value = valueof(values[i], i, values)) != null) {
              if (min > value) min = value;
              if (max < value) max = value;
            }
          }
        }
      }
    }
    return [min, max];
  }

  // code/node_modules/d3-array/src/array.js
  var array = Array.prototype;
  var slice = array.slice;
  var map = array.map;

  // code/node_modules/d3-array/src/ticks.js
  var e10 = Math.sqrt(50);
  var e5 = Math.sqrt(10);
  var e2 = Math.sqrt(2);

  // code/src/lava/flowmap/algo.ts
  function delta(arr, s) {
    const pair2 = extent_default(arr, s);
    return pair2[1] - pair2[0] || 0;
  }
  function layout(source, targets, weights) {
    if (weights) {
      var tree = new SpiralTree(source, targets, (i) => weights[i]);
    } else {
      var tree = new SpiralTree(source, targets, (i) => 1);
    }
    return new FlowLayout(new PathBuilder(tree));
  }
  var config = {
    // This number is used to control the degree of the source. The bigger this value is,
    // the bigger the degree, which means less clutter around the source. The default
    // value is 2, meaning four directions to the root.
    maxPsudoRootCount: 3,
    // For tree edges (a,b) and (b, c), we put two points in them (a, a', b) and (b, c', c).
    // then we draw (a', b, c') as a quadratic curve. So the locations of a' and c' are
    // decided by this value, i.e., length(a', b) = length(a, b) * defaultCurveFraction. 
    // Of course, then length(a', b) is caped by maxCurveSegmentLengthOnScreen. The default
    // value is 0.45.
    defaultCurveFraction: 0.45,
    // This vlaue is the retricting angle between two tree branches. The default is PI/10.        
    alpha: Math.PI / 10,
    // This value is the threshold to check if two points are two close or not. The default
    // value is 1.
    overlapThreshold: 1,
    // Whether branching point is shifted based on weights
    useWeightedJointPoint: true,
    // How many iterations called to smooth edges
    sideLeafSmoothIterations: 2
  };
  var FlowPath = class {
    constructor() {
      this.lineStart = [];
      this.lineEnd = [];
      this.curveCtl = [];
      this.curveEnd = [];
      //[parent weight, self weight]
      this.offset = [0, 0, 0, 0];
      this.conv = null;
    }
    d(conv) {
      var result = [], tmp = [0, 0];
      var offx = this.offset[0] * this.offset[2] * this.offset[3];
      var offy = this.offset[1] * this.offset[2] * this.offset[3];
      this.conv = conv = conv || this.conv;
      conv = conv || ((input) => {
        tmp = input;
      });
      conv(this.lineStart, tmp);
      result.push("M", tmp[0], tmp[1]);
      conv(this.lineEnd, tmp);
      if (this.curveCtl.length <= 0) {
        result.push("L", tmp[0], tmp[1]);
      } else {
        result.push("C", tmp[0], tmp[1]);
        conv(this.curveCtl, tmp);
        result.push(tmp[0] + offx, tmp[1] + offy);
        conv(this.curveEnd, tmp);
        result.push(tmp[0] + offx, tmp[1] + offy);
      }
      return result.join(" ");
    }
    width(scale) {
      if (scale) {
        this.pathWidth = scale(this.weights[1]);
        this.offset[2] = scale(this.weights[0]) / 2 - this.pathWidth / 2;
      }
      return this.pathWidth;
    }
    get weight() {
      return this.weights[1];
    }
  };
  var ChainPath = class {
    constructor(chain, index, main, prev) {
      this.offset = [].concat(chain[index].offset);
      this.flowchain = chain;
      this.index = index;
      this.main = main;
      this.id = main.id + "_up_" + index;
      this.leafs = main.leafs;
      this.prev = prev;
    }
    get weight() {
      return this.main.weights[1];
    }
    d(conv) {
      var poff = this.prev.offset;
      var lofx = poff[0] * poff[2] * poff[3];
      var lofy = poff[1] * poff[2] * poff[3];
      var offx = this.offset[0] * this.offset[2] * this.offset[3];
      var offy = this.offset[1] * this.offset[2] * this.offset[3];
      var result = [], tmp = [0, 0];
      this.conv = conv = conv || this.conv;
      conv = conv || ((input) => {
        tmp = input;
      });
      var curr = this.flowchain[this.index];
      conv(curr.lineStart, tmp);
      result.push("M", tmp[0] + lofx, tmp[1] + lofy);
      conv(curr.lineEnd, tmp);
      result.push("L", tmp[0] + lofx, tmp[1] + lofy);
      if (curr.curveCtl.length > 0) {
        conv(curr.curveCtl, tmp);
        result.push("Q", tmp[0] + offx, tmp[1] + offy);
        conv(curr.curveEnd, tmp);
        result.push(tmp[0] + offx, tmp[1] + offy);
      }
      return result.join(" ");
    }
    width(scale) {
      if (scale) {
        var shift = this.main.offset[2] * this.main.offset[3];
        for (var i = 0; i <= this.index; i++) {
          var p = this.flowchain[i];
          shift += p.offset[2] * p.offset[3];
        }
        this.offset[2] = Math.abs(shift);
        this.offset[3] = shift > 0 ? 1 : -1;
      }
      return this.main.width();
    }
  };
  var FlowLayout = class {
    // private _nodes: NodeKeeper;
    constructor(builder) {
      this._paths = [];
      this._id2Path = {};
      this._builder = builder;
      this._paths = builder.build();
      this._id2Path = {};
      for (var p of this._paths) {
        this._id2Path[p.id] = p;
      }
    }
    subroots(keys) {
      return this._builder.subroots(keys).map((nid) => this._id2Path[nid]);
    }
    flow(path) {
      return this._ancestors(path).concat(path).concat(this._builder.offspring(path.id).map((nid) => this._id2Path[nid]));
    }
    paths(scale) {
      if (scale) {
        this._scale = scale;
        for (var p of this._paths) {
          p.width(scale);
        }
      }
      return this._paths;
    }
    _ancestors(path) {
      var pid = path.id;
      var chain = this._builder.ancestors(pid).map((id) => this._id2Path[id]);
      var result = [];
      for (var i = 0; i < chain.length; i++) {
        result.push(new ChainPath(chain, i, path, i === 0 ? path : result[i - 1]));
      }
      return result;
    }
    build(weight) {
      if (weight) {
        this._builder.reweight(weight);
        for (let p of this._paths) {
          p.weights = p.nodes.map((n) => n.weight);
          p.width(this._scale);
        }
      }
      return this._paths;
    }
    visit(v) {
      this._builder.visit(v);
      return this;
    }
  };
  var SortedList = class {
    constructor() {
      this.clear();
    }
    clear() {
      this._key = [];
      this._value = [];
    }
    insert(key, value) {
      var i = this.find(key, false);
      this._key.splice(i, 0, key);
      this._value.splice(i, 0, value);
    }
    remove(index) {
      this._key.splice(index, 1);
      this._value.splice(index, 1);
    }
    indexOf(key) {
      return this.find(key, true);
    }
    get length() {
      return this._key.length;
    }
    valueAt(index) {
      return this._value[index];
    }
    find(key, exactMatch) {
      var left = 0;
      var right = this._key.length;
      while (left < right) {
        var mid = Math.floor((left + right) / 2);
        if (this._key[mid] == key) {
          return mid;
        }
        if (this._key[mid] < key) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }
      if (exactMatch) {
        return -1;
      }
      return left;
    }
  };
  var vector;
  ((vector2) => {
    function unit(e1, e22) {
      let a = e22.x - e1.x, b = e22.y - e1.y;
      let s = Math.sqrt(a * a + b * b);
      return [a / s, b / s];
    }
    vector2.unit = unit;
    function scale(e1, e22, scale2) {
      let a = e22.x - e1.x, b = e22.y - e1.y;
      return [a * scale2, b * scale2];
    }
    vector2.scale = scale;
    function create(e1, e22) {
      return [e22.x - e1.x, e22.y - e1.y];
    }
    vector2.create = create;
    function length(e1, e22, len) {
      let a = e22.x - e1.x, b = e22.y - e1.y;
      let s = Math.sqrt(a * a + b * b);
      return [a / s * len, b / s * len];
    }
    vector2.length = length;
    function norm(vec) {
      return Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1]);
    }
    vector2.norm = norm;
  })(vector || (vector = {}));
  var point;
  ((point2) => {
    function add(p, vec) {
      return { x: p.x + vec[0], y: p.y + vec[1] };
    }
    point2.add = add;
    function middle(s, e, frac) {
      return { x: e.x * frac + s.x * (1 - frac), y: e.y * frac + s.y * (1 - frac) };
    }
    point2.middle = middle;
  })(point || (point = {}));
  var util;
  ((util2) => {
    function cos(p, e1, e22) {
      var v1 = vector.unit(p, e1);
      var v2 = vector.unit(p, e22);
      return v1[0] * v2[0] + v1[1] * v2[1];
    }
    util2.cos = cos;
    function length(x1, y1, x2, y2) {
      return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
    }
    function distance(e1, e22, square = false) {
      let a = e22.x - e1.x, b = e22.y - e1.y;
      if (square) {
        return a * a + b * b;
      } else {
        return Math.sqrt(a * a + b * b);
      }
    }
    util2.distance = distance;
    function distanceToLine(p, e1, e22) {
      let len2 = distance(e1, e22);
      len2 = len2 * len2;
      if (len2 == 0) {
        return distance(e1, p);
      }
      var t = ((p.x - e1.x) * (e22.x - e1.x) + (p.y - e1.y) * (e22.y - e1.y)) / len2;
      if (t < 0) {
        return distance(e1, p);
      }
      if (t > 1) {
        return distance(e22, p);
      }
      return length(p.x, p.y, e1.x + t * (e22.x - e1.x), e1.y + t * (e22.y - e1.y));
    }
    util2.distanceToLine = distanceToLine;
    function inTriangle(test, p0, p1, p2) {
      var deno = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
      var a = ((p1.y - p2.y) * (test.x - p2.x) + (p2.x - p1.x) * (test.y - p2.y)) / deno;
      var b = ((p2.y - p0.y) * (test.x - p2.x) + (p0.x - p2.x) * (test.y - p2.y)) / deno;
      var c = 1 - a - b;
      var result0 = 0 <= a && a <= 1 && 0 <= b && b <= 1 && 0 <= c && c <= 1;
      return result0;
    }
    util2.inTriangle = inTriangle;
    function sign(p1, p2, test) {
      var x = (p1.x - test.x) * (p2.y - test.y) - (p2.x - test.x) * (p1.y - test.y);
      if (x > 0) return 1;
      if (x < 0) return -1;
      return 0;
    }
    util2.sign = sign;
    function binarySearch(array2, target, isSmallest) {
      var left = 0;
      var right = array2.length;
      while (left < right) {
        var mid = Math.floor((left + right) / 2);
        if (array2[mid] == target) {
          return mid;
        }
        if (array2[mid] < target)
          left = mid + 1;
        else
          right = mid;
      }
      return ~left;
    }
    util2.binarySearch = binarySearch;
    function extent(sorted, min, max) {
      var start = binarySearch(sorted, min, true);
      start = Math.max(0, (start < 0 ? ~start : start) - 1);
      var mark = sorted[start];
      while (start > 0 && sorted[start - 1] == mark) {
        start--;
      }
      var end = binarySearch(sorted, max, false);
      end = end < 0 ? Math.min(sorted.length - 1, ~end) : end;
      var mark = sorted[end];
      while (end < sorted.length - 1 && mark == sorted[end + 1]) {
        end++;
      }
      return [start, end];
    }
    util2.extent = extent;
  })(util || (util = {}));
  var SmoothResult = class {
    constructor(spiral) {
      this._sprial = null;
      this._nid2pare = {};
      this._offspring = [];
      this._nid2root = {};
      this._nid2Node = {};
      this._key2Leaf = {};
      this._sprial = spiral;
      let root = this.root = spiral.root;
      if (!root) {
        return;
      }
      let roots = this._nid2root = this._psudoRoots();
      for (var [child, parent] of this._sprial.edges()) {
        this._nid2pare[child.nid] = roots[parent.nid] ? root : parent;
      }
      var collectLeafInfo = (n) => {
        if (n.type === NodeTypes.Leaf) {
          n.leafs = [n.key];
          this._key2Leaf[n.key] = n;
          return;
        }
        let info = [];
        if (n.PChild) {
          if (!n.PChild.leafs) {
            collectLeafInfo(n.PChild);
          }
          info.push(...n.PChild.leafs);
        }
        if (n.MChild) {
          if (!n.MChild.leafs) {
            collectLeafInfo(n.MChild);
          }
          info.push(...n.MChild.leafs);
        }
        n.leafs = info;
      };
      collectLeafInfo(root);
      var queue = [root];
      this._nid2Node[root.nid] = root;
      var queueDown = (n) => {
        if (n) {
          queue.push(n);
          if (!roots[n.nid]) {
            this._nid2Node[n.nid] = n;
            this._offspring.push(n);
          }
        }
      };
      while (queue.length > 0) {
        var node = queue.shift();
        if (node.type === NodeTypes.Joint) {
          queueDown(node.PChild);
          queueDown(node.MChild);
        }
      }
    }
    _psudoRoots() {
      var roots = {};
      if (!this._sprial.root) {
        return roots;
      }
      roots[this._sprial.root.nid] = this._sprial.root;
      let levelDown = (nodes) => {
        var result = [];
        var threshold = Math.cos(Math.PI / 2);
        for (var node of nodes) {
          if (node.type !== NodeTypes.Joint) {
            continue;
          }
          if (node.MChild && node.MChild.MChild && node.MChild.PChild) {
            var cos = util.cos(node.MChild, node.MChild.MChild, node.MChild.PChild);
            if (cos < threshold) {
              result.push(node.MChild);
            }
          }
          if (node.PChild && node.PChild.MChild && node.PChild.PChild) {
            var cos = util.cos(node.PChild, node.PChild.MChild, node.PChild.PChild);
            if (cos < threshold) {
              result.push(node.PChild);
            }
          }
        }
        return result;
      };
      let tmp = [this._sprial.root];
      for (var i = 0; i < 10; i++) {
        tmp = levelDown(tmp);
        if (tmp.length === 0) {
          break;
        }
        for (var n of tmp) {
          roots[n.nid] = n;
        }
        if (Object.keys(roots).length > config.maxPsudoRootCount) {
          break;
        }
      }
      return roots;
    }
    //return all nodes, excluding the roots or the given nid, in the bfs fashion
    offspring(nid) {
      if (nid === void 0) {
        return this._offspring;
      } else {
        var queue = [this._nid2Node[nid]];
        var result = [];
        var down = (n) => {
          if (n) {
            queue.push(n);
            result.push(n);
          }
        };
        while (queue.length > 0) {
          var node = queue.shift();
          if (node.type === NodeTypes.Joint) {
            down(node.PChild);
            down(node.MChild);
          }
        }
        return result;
      }
    }
    //return parent, ..., excluding roots        
    ancestors(nid) {
      var node = this._nid2Node[nid];
      var result = [];
      var parent = this.parent(node);
      while (parent) {
        if (this._nid2root[parent.nid]) {
          break;
        }
        result.push(parent);
        parent = this.parent(parent);
      }
      return result;
    }
    merge(keys) {
      var marks = {};
      for (var k of keys) {
        marks[k] = true;
      }
      var nids = keys.map((k2) => this._key2Leaf[k2].nid);
      var result = [];
      while (nids.length > 0) {
        var nid = nids.shift();
        var parent = this.parent(this.node(nid));
        var leafs = parent.leafs;
        while (leafs.every((l) => marks[l])) {
          nid = parent.nid;
          parent = this.parent(parent);
          leafs = parent.leafs;
        }
        result.push(nid);
        for (var key of this.node(nid).leafs) {
          delete marks[key];
        }
        nids = Object.keys(marks).map((k2) => this._key2Leaf[k2].nid);
      }
      return result;
    }
    node(nid) {
      return this._nid2Node[nid];
    }
    leaf(key) {
      return this._key2Leaf[key];
    }
    parent(node) {
      if (node === this._sprial.root || node === null) {
        return null;
      } else {
        return this._nid2pare[node.nid];
      }
    }
  };
  var EdgeSmoother = class {
    constructor(tree) {
      this._spiral = null;
      this._spiral = tree;
    }
    // Main function to call to smooth the tree edges
    run() {
      if (this._spiral.root) {
        this._adjustInnerAuxNode();
        for (var i = 0; i < config.sideLeafSmoothIterations; i++) {
          this._adjustSideLeaf();
        }
        this._adjustEndLeaf();
      }
      return new SmoothResult(this._spiral);
    }
    //private
    // Adjust the internal nodes whose one child is leaf and the other is non-leaf.
    _adjustSideLeaf() {
      for (var node of this._spiral.offspring()) {
        if (node.type !== NodeTypes.Joint) {
          continue;
        }
        if (node.MChild === null || node.PChild === null) {
          continue;
        }
        if (node.MChild.type == NodeTypes.Joint) {
          if (node.PChild.type == NodeTypes.Joint) {
            continue;
          }
        }
        var child = null;
        if (node.MChild.type == NodeTypes.Joint) {
          child = node.MChild;
        } else if (node.PChild.type == NodeTypes.Joint) {
          child = node.PChild;
        }
        if (child) {
          this._adjustPath(node.parent, node, child);
        } else {
        }
      }
      ;
    }
    // Remove the auxNode if it has only one child.
    _tryRemoveAuxNode(auxNode, child) {
      if (auxNode.PChild != null && auxNode.MChild != null) {
        return;
      }
      var parentNode = auxNode.parent;
      if (parentNode.MChild == auxNode) {
        parentNode.MChild = child;
      } else if (parentNode.PChild == auxNode) {
        parentNode.PChild = child;
      }
      child.parent = parentNode;
    }
    // Try to adjust the location of node, given its parent and child nodes.
    _adjustPath(parent, self, child) {
      var closenessThreshold = Math.min(self.length(child), self.length(parent)) / 5;
      var hits = this._tryStraighten(parent, self, child, closenessThreshold);
      if (hits == null) {
        this._tryRemoveAuxNode(self, child);
        return;
      }
      if (hits[0].length == 1 && hits[1].length == 0) {
        var auxPoint = this._calcNewLocation(self, hits[0][0], closenessThreshold);
        self.update(this._spiral.root, auxPoint);
      }
      if (hits[0].length == 0 && hits[1].length == 1) {
        var hitNode = hits[1][0];
        var auxPoint = this._calcNewLocation(self, hitNode, closenessThreshold);
        let minDist = Math.min(hitNode.distance(auxPoint, parent), hitNode.distance(auxPoint, child));
        if (minDist < hitNode.distance(parent, child)) {
          this._tryRemoveAuxNode(self, child);
        } else {
          if (util.sign(parent, child, hitNode) == util.sign(parent, child, self)) {
            this._tryRemoveAuxNode(self, child);
          } else if (util.sign(parent, child, auxPoint) == util.sign(parent, child, self)) {
            self.update(this._spiral.root, auxPoint);
          } else {
          }
        }
      }
    }
    // Find a new point between hitNode and node.
    _calcNewLocation(node, hitNode, threshold) {
      let vec = vector.create(hitNode, node);
      let length = vector.norm(vec);
      let scale = Math.min(length / 2, threshold) / length;
      return {
        x: hitNode.x + vec[0] * scale,
        y: hitNode.y + vec[1] * scale
      };
    }
    // Adjust inner nodes that only have only one non-leaf child.
    _adjustInnerAuxNode() {
      var allJointNodes = [];
      for (var node of this._spiral.offspring()) {
        if (node.type !== NodeTypes.Joint) {
          continue;
        }
        var child = null;
        if (!node.MChild && node.PChild.type == NodeTypes.Joint) {
          child = node.PChild;
        }
        if (!node.PChild && node.MChild.type == NodeTypes.Joint) {
          child = node.MChild;
        }
        if (child) {
          this._adjustPath(node.parent, node, child);
        }
      }
    }
    // Try to move the location of node to make the line (parent->node->child) straight
    _tryStraighten(parent, node, child, closeness) {
      var candidates = this._spiral.inRange([parent, node, child]);
      var contained = [];
      for (var t of candidates) {
        if (util.inTriangle(t, parent, node, child)) {
          contained.push(t);
        }
      }
      var tooClose = [];
      for (var t of candidates) {
        if (contained.indexOf(t) < 0 && t.distance(parent, child) < closeness) {
          tooClose.push(t);
        }
      }
      if (contained.length === 0 && tooClose.length === 0) {
        let vec = vector.length(parent, child, util.distance(parent, node));
        node.update(this._spiral.root, point.add(parent, vec));
        return null;
      } else {
        return [contained, tooClose];
      }
    }
    // Adjust the leaf nodes, to make sure the angle of (grandpa<-parent->leaf) is big enough
    _adjustEndLeaf() {
      for (var node of this._spiral.offspring()) {
        if (node.type === NodeTypes.Joint) {
          continue;
        }
        var parent = node.parent;
        if (parent === this._spiral.root) {
          continue;
        }
        var grandpa = parent.parent;
        if (parent.MChild == null || parent.PChild == null) {
          let newPoint = point.add(parent, vector.scale(parent, node, 0.5));
          let safe = true;
          for (var c of this._spiral.inRange([node, parent, grandpa])) {
            if (util.inTriangle(c, node, parent, newPoint)) {
              safe = false;
              break;
            } else if (util.inTriangle(c, parent, grandpa, newPoint)) {
              safe = false;
              break;
            }
          }
          safe && parent.update(this._spiral.root, newPoint);
          continue;
        }
        let cos = util.cos(parent, node, grandpa);
        if (cos > 0 - Math.cos(config.alpha * 3)) {
          if (parent.PChild == node) {
            var jnode = this._spiral.createJointNode(parent, parent.MChild, null);
            parent.MChild = jnode;
            if (jnode.MChild) {
              jnode.MChild.parent = jnode;
            }
            jnode.parent = parent;
          } else {
            var jnode = this._spiral.createJointNode(parent, null, parent.PChild);
            parent.PChild = jnode;
            if (jnode.PChild) {
              jnode.PChild.parent = jnode;
            }
            jnode.parent = parent;
          }
          var newParentPoint = point.add(parent, vector.scale(parent, grandpa, 0.5));
          parent.update(this._spiral.root, newParentPoint);
        }
      }
    }
  };
  var NodeKeeper = class {
    constructor(tryJoinFunc) {
      this._sortedByTheta = null;
      this._jointList = null;
      this._tryJoinFunc = null;
      this._tryJoinFunc = tryJoinFunc;
      this._sortedByTheta = new SortedList();
      this._jointList = [];
    }
    length() {
      return this._sortedByTheta.length;
    }
    insert(node) {
      this._sortedByTheta.insert(node.theta, node);
      if (this.length() == 1) {
        this._jointList.push(null);
      } else {
        var index = this._sortedByTheta.indexOf(node.theta);
        this._jointList.splice(index, 0, null);
        var prevIndex = index == 0 ? this.length() - 1 : index - 1;
        var nextIndex = index == this.length() - 1 ? 0 : index + 1;
        var prevNode = this._sortedByTheta.valueAt(prevIndex);
        var nextNode = this._sortedByTheta.valueAt(nextIndex);
        this._jointList[prevIndex] = this._tryJoinFunc(prevNode, node);
        this._jointList[index] = this._tryJoinFunc(node, nextNode);
      }
    }
    remove(node) {
      var index = this._sortedByTheta.indexOf(node.theta);
      this._sortedByTheta.remove(index);
      this._jointList.splice(index, 1);
      if (this._jointList.length == 0) {
        return;
      } else if (this._jointList.length == 1) {
        this._jointList[0] = null;
        return;
      }
      var prevIndex = index == 0 ? this.length() - 1 : index - 1;
      var prevNode = this._sortedByTheta.valueAt(prevIndex);
      var currNode = this._sortedByTheta.valueAt(index == this.length() ? 0 : index);
      this._jointList[prevIndex] = this._tryJoinFunc(prevNode, currNode);
    }
    values() {
      var temp = [];
      for (var i = 0; i < this._sortedByTheta.length; i++) {
        temp.push(this._sortedByTheta.valueAt(i));
      }
      return temp;
    }
    // Go through every pair of neighboring FlowNodes, and find the one that the joint node
    // has biggest radius
    getMaxRadiusPair() {
      var index = -1;
      var maxSoFar = Number.NEGATIVE_INFINITY;
      for (var i = 0; i < this._jointList.length; i++) {
        var tmp = this._jointList[i];
        if (tmp != null) {
          if (tmp.radius > maxSoFar) {
            index = i;
            maxSoFar = tmp.radius;
          }
        }
      }
      if (index < 0) {
        return null;
      }
      return this._jointList[index];
    }
    // Find the neighoring FlowNodes based on Theta
    searchNeighbours(target) {
      var length = this.length();
      if (length <= 1) {
        return null;
      }
      var idx = this._sortedByTheta.indexOf(target.theta);
      if (idx < 0) {
        throw "cannot find the theta in the sorted list";
      }
      var smaller = this._sortedByTheta.valueAt(idx == 0 ? length - 1 : idx - 1);
      var bigger = this._sortedByTheta.valueAt(idx == length - 1 ? 0 : idx + 1);
      return [smaller, bigger];
    }
    clear() {
      this._sortedByTheta.clear();
    }
  };
  var NodeTypes = class {
  };
  NodeTypes.Joint = "joint";
  NodeTypes.Leaf = "leaf";
  var _FlowNode = class _FlowNode {
    constructor() {
      this.nid = "flownode_" + _FlowNode._CNT++;
    }
    length(point2) {
      return util.distance(this, point2);
    }
    distance(e1, e22) {
      return util.distanceToLine(this, e1, e22);
    }
    update(origin, point2) {
      this.x = point2.x;
      this.y = point2.y;
      this.radius = util.distance(origin, point2);
      this.theta = _FlowNode._CalcTheta(point2.x - origin.x, point2.y - origin.y, this.radius);
    }
    static Create(x, y, r, t, w, type, obj) {
      var result = new _FlowNode();
      result.x = x;
      result.y = y;
      result.weight = w;
      result.type = type;
      result.radius = r;
      result.theta = t;
      result.key = obj;
      return result;
    }
    static FromPolar(origin, point2, weight, type) {
      var x = point2.radius * Math.cos(point2.theta) + origin.x;
      var y = point2.radius * Math.sin(point2.theta) + origin.y;
      return _FlowNode.Create(x, y, point2.radius, point2.theta, weight, type, null);
    }
    static FromCartesian(origin, point2, weight, type) {
      var radius = util.distance(origin, point2);
      var theta = _FlowNode._CalcTheta(point2.x - origin.x, point2.y - origin.y, radius);
      return _FlowNode.Create(point2.x, point2.y, radius, theta, weight, type, point2.key);
    }
    static _CalcTheta(dx, dy, radius) {
      if (radius == 0) {
        return 0;
      }
      var theta = Math.acos(dx / radius);
      if (dy < 0) {
        return 2 * Math.PI - theta;
      } else {
        return theta;
      }
    }
  };
  _FlowNode._CNT = 1;
  var FlowNode = _FlowNode;
  var _SpiralTree = class _SpiralTree {
    constructor(src, tars, weight) {
      //used to cache the intermediate result of calculations
      this._nodeKeeper = null;
      //used to record all destination Node, must be sorted by radius (from large to small) distance before building tree.
      this._destList = null;
      //used to record the source Node
      this._source = null;
      //used to ensure that there are no nodes share the same angle Theta
      this._duplicatedAngleChecker = null;
      //the root node of spiral tree, it is literally the source point, but it's converted into a joinNode
      this.root = null;
      this._sortedByX = [];
      this._sortedX = [];
      this._sortedByY = [];
      this._sortedY = [];
      let mark = {};
      mark[src.x + "," + src.y] = true;
      let smallx = delta(tars, (t) => t.x) / 1e5;
      let smally = delta(tars, (t) => t.y) / 1e5;
      for (let t of tars) {
        let key = t.x + "," + t.y;
        while (key in mark) {
          t.x += smallx * Math.random();
          t.y += smally * Math.random();
          key = t.x + "," + t.y;
        }
        mark[key] = true;
      }
      this._nodeKeeper = new NodeKeeper(this._tryJoin);
      this._destList = [];
      this._duplicatedAngleChecker = {};
      this._destList = [];
      this._source = src;
      weight = weight || ((w) => 1);
      for (var i = 0, len = tars.length; i < len; i++) {
        var node = FlowNode.FromCartesian(src, tars[i], weight(i), NodeTypes.Leaf);
        this._destList.push(node);
      }
      this._destList.sort((a, b) => {
        return b.radius - a.radius;
      });
      this._build();
    }
    offspring() {
      var result = [];
      if (!this.root) {
        return result;
      }
      var queue = [this.root];
      while (queue.length > 0) {
        var node = queue.shift();
        if (node.type == NodeTypes.Joint) {
          if (node.PChild) {
            var child = node.PChild;
            queue.push(child);
            result.push(child);
          }
          if (node.MChild) {
            var child = node.MChild;
            queue.push(child);
            result.push(child);
          }
        }
      }
      return result;
    }
    visit(act) {
      if (!this.root) {
        return;
      }
      var queue = [this.root];
      act(this.root);
      while (queue.length > 0) {
        var node = queue.shift();
        if (node.type == NodeTypes.Joint) {
          if (node.PChild) {
            var child = node.PChild;
            queue.push(child);
            act(child);
          }
          if (node.MChild) {
            var child = node.MChild;
            queue.push(child);
            act(child);
          }
        }
      }
    }
    // get all edges (DFS) in this tree like this [[child, parent], [child, parent], ...].        
    edges(node = null) {
      var result = [];
      if (!node) {
        node = this.root;
      }
      if (node && node.type == NodeTypes.Joint) {
        var plus = node.PChild;
        var minus = node.MChild;
        if (plus != null) {
          result.push([plus, node]);
          result.push(...this.edges(plus));
        }
        if (minus != null) {
          result.push([minus, node]);
          result.push(...this.edges(minus));
        }
      } else {
      }
      return result;
    }
    createJointNode(polar, childMinus, childPlus) {
      var weight = childMinus == null ? 0 : childMinus.weight;
      weight += childPlus == null ? 0 : childPlus.weight;
      var ret = FlowNode.FromPolar(this._source, polar, weight, NodeTypes.Joint);
      ret.PChild = childPlus;
      ret.MChild = childMinus;
      return ret;
    }
    // Get all the leaves that fall in the bounding box (expanded by the size of buffer)
    // of passed-in nodes.
    inRange(nodes) {
      var minX = nodes[0].x, maxX = minX;
      var minY = nodes[0].y, maxY = minY;
      for (var node of nodes) {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
      }
      var [startX, endX] = util.extent(this._sortedX, minX, maxX);
      var [startY, endY] = util.extent(this._sortedY, minY, maxY);
      var result = [], temp = {};
      for (var i = startX; i <= endX; i++) {
        temp[this._sortedByX[i].key] = true;
      }
      for (var n of nodes) {
        temp[n.key] = false;
      }
      for (var i = startY; i <= endY; i++) {
        if (temp[this._sortedByY[i].key]) {
          result.push(this._sortedByY[i]);
        }
      }
      return result;
    }
    //private
    // main function to build the spiral tree
    _build() {
      this._nodeKeeper.clear();
      this._duplicatedAngleChecker = {};
      var destIndex = 0;
      var jointNode = null;
      while (destIndex < this._destList.length || this._nodeKeeper.length() != 0) {
        if (destIndex >= this._destList.length && jointNode == null) {
          var node = this._nodeKeeper.values()[0];
          this.root = this._createAuxCircleJointNode(node, 0, 1 /* Plus */);
          this._nodeKeeper.remove(node);
          break;
        }
        var mostDistantLeaf = this._destList[destIndex];
        destIndex++;
        this._ensureNodeThetaUnique(mostDistantLeaf);
        this._nodeKeeper.insert(mostDistantLeaf);
        this._replaceWithAuxNodeIfNotJoinable(mostDistantLeaf);
        var nextLargestRadius = destIndex < this._destList.length ? this._destList[destIndex].radius : 0;
        jointNode = this._generateJointNode(nextLargestRadius);
        while (jointNode != null) {
          this._processJointNode(jointNode);
          jointNode = this._generateJointNode(nextLargestRadius);
        }
      }
      this.visit((n) => {
        if (n && n.MChild) {
          n.MChild.parent = n;
        }
        if (n && n.PChild) {
          n.PChild.parent = n;
        }
      });
      if (this.root) {
        this._sortedByX = [this.root];
        this._sortedByY = [this.root];
        for (var node of this.offspring()) {
          if (node.type === NodeTypes.Leaf) {
            this._sortedByX.push(node);
            this._sortedByY.push(node);
          }
        }
        this._sortedByX.sort((a, b) => a.x - b.x);
        this._sortedX = this._sortedByX.map((v) => v.x);
        this._sortedByY.sort((a, b) => a.y - b.y);
        this._sortedY = this._sortedByY.map((v) => v.y);
      }
      return this;
    }
    _tryJoin(rightNode, leftNode) {
      if (rightNode.radius == 0 || leftNode.radius == 0) {
        var ret = new FlowNode();
        ret.radius = 0;
        ret.theta = 0;
        return ret;
      }
      var tanAlpha = Math.tan(config.alpha);
      var thetaDelta = leftNode.theta - rightNode.theta;
      thetaDelta = _SpiralTree._EnsureBetweenZeroAndTwoPi(thetaDelta);
      thetaDelta = thetaDelta / tanAlpha;
      var radiusDelta = Math.log(rightNode.radius / leftNode.radius);
      var tPlus = (thetaDelta + radiusDelta) / 2;
      var tMinus = (thetaDelta - radiusDelta) / 2;
      if (_SpiralTree._IsValid(tPlus, tMinus, Math.PI / tanAlpha)) {
        var jointTheta = rightNode.theta + tanAlpha * tPlus;
        var jointRadius = rightNode.radius * Math.exp(-tPlus);
        jointTheta = _SpiralTree._EnsureBetweenZeroAndTwoPi(jointTheta);
        var ret = new FlowNode();
        ret.theta = jointTheta;
        ret.radius = jointRadius;
        ret.MChild = leftNode;
        ret.PChild = rightNode;
        return ret;
      } else {
        return null;
      }
    }
    /// <summary>
    /// search for every two adjacent Nodes and check whether their paths can join together
    /// </summary>
    /// <param name="waveFront">a data set that stores every unhandlered nodes</param>
    /// <param name="minRadius"></param>
    /// <returns>return the most likely joinNode</returns>
    _generateJointNode(radiusThreshold) {
      var max = this._nodeKeeper.getMaxRadiusPair();
      if (max == null) {
        return null;
      } else {
        if (max.radius < radiusThreshold) {
          return null;
        }
        var result = this.createJointNode(max, max.MChild, max.PChild);
        if (config.useWeightedJointPoint) {
          var tmp = this._weightedJointNode(result.PChild, result.MChild, radiusThreshold);
          if (tmp != null) {
            return tmp;
          }
        }
        return result;
      }
    }
    _weightedJointNode(rightNode, leftNode, radiusThreshold) {
      if (rightNode.radius == 0 || leftNode.radius == 0) {
        return FlowNode.Create(this._source.x, this._source.y, 0, 0, 0, NodeTypes.Joint, this._source.key);
      }
      var tan2Alpha = Math.tan(config.alpha * 2);
      var thetaDelta = leftNode.theta - rightNode.theta;
      thetaDelta = _SpiralTree._EnsureBetweenZeroAndTwoPi(thetaDelta);
      thetaDelta = thetaDelta / tan2Alpha;
      var radiusDelta = Math.log(rightNode.radius / leftNode.radius);
      var polar = { radius: 0, theta: 0 };
      var tPlus = (thetaDelta + radiusDelta) / 2;
      var tMinus = (thetaDelta - radiusDelta) / 2;
      if (!_SpiralTree._IsValid(tPlus, tMinus, Math.PI / tan2Alpha)) {
        return null;
      }
      if (leftNode.type == NodeTypes.Joint && rightNode.type != NodeTypes.Joint) {
        tPlus = thetaDelta;
        tMinus = thetaDelta - radiusDelta;
        polar.radius = rightNode.radius * Math.exp(-tPlus);
        polar.theta = leftNode.theta;
      } else if (rightNode.type == NodeTypes.Joint && leftNode.type != NodeTypes.Joint) {
        tPlus = thetaDelta + radiusDelta;
        tMinus = thetaDelta;
        polar.radius = rightNode.radius * Math.exp(-tPlus);
        polar.theta = rightNode.theta;
      } else if (leftNode.weight > rightNode.weight) {
        tPlus = thetaDelta;
        tMinus = thetaDelta - radiusDelta;
        polar.radius = rightNode.radius * Math.exp(-tPlus);
        polar.theta = leftNode.theta;
      } else if (rightNode.weight > leftNode.weight) {
        tPlus = thetaDelta + radiusDelta;
        tMinus = thetaDelta;
        polar.radius = rightNode.radius * Math.exp(-tPlus);
        polar.theta = rightNode.theta;
      } else {
        return null;
      }
      if (polar.radius < radiusThreshold) {
        return null;
      }
      return this.createJointNode(polar, leftNode, rightNode);
    }
    /// <summary>
    /// calculate a temporary stein node that is moved from current point
    /// called when there is no proper point to join with current point due to the large difference of radius
    /// the path of current point with larger radius can only go towards source point further without joining other points
    /// </summary>
    /// <param name="node">input Node that doesn't have proper point to join with</param>
    /// <param name="auxRadius">decide the radius of result Node</param>
    /// <param name="sign">decide the direction(angle) the Node moved from input Node.it is used to improve to the chance for new calculated Node to join with other Nodes</param>
    /// <returns></returns>
    _createAuxCircleJointNode(node, auxRadius, sign) {
      if (auxRadius == 0) {
        var root = FlowNode.Create(this._source.x, this._source.y, 0, 0, node.weight, NodeTypes.Joint, this._source.key);
        root.PChild = node;
        return root;
      } else {
        var auxTi = 0 - Math.log(auxRadius / node.radius);
        var auxTheta = node.theta + Math.tan(sign * config.alpha) * auxTi;
        auxTheta = _SpiralTree._EnsureBetweenZeroAndTwoPi(auxTheta);
        var polar = { radius: auxRadius, theta: auxTheta };
        if (sign == 1 /* Plus */) {
          return this.createJointNode(polar, null, node);
        } else {
          return this.createJointNode(polar, node, null);
        }
      }
    }
    /// <summary>
    /// insert input node into waveFront set and handle some special cases
    /// there are literally two special cases that needs to be handled
    /// 1.current node can not join with its left node(by comparing their angles)
    /// 2.current node can not join with its right node
    /// </summary>
    /// <param name="currNode">next unhandlered node</param>
    _replaceWithAuxNodeIfNotJoinable(currNode) {
      var rightAndLeft = this._nodeKeeper.searchNeighbours(currNode);
      if (rightAndLeft == null) {
        return;
      }
      var right = rightAndLeft[0];
      var left = rightAndLeft[1];
      if (currNode != left && this._tryJoin(currNode, left) == null) {
        this._replaceWithAuxCircleJointNode(left, currNode.radius, 1 /* Plus */);
      } else if (currNode != right && this._tryJoin(right, currNode) == null) {
        this._replaceWithAuxCircleJointNode(right, currNode.radius, -1 /* Minus */);
      } else {
      }
    }
    _replaceWithAuxCircleJointNode(toBeReplaced, auxRadius, sign) {
      var newJointNode = this._createAuxCircleJointNode(toBeReplaced, auxRadius, sign);
      this._nodeKeeper.remove(toBeReplaced);
      this._nodeKeeper.insert(newJointNode);
    }
    /// <summary>
    /// check whether the current joinNode overlaps with any terminal nodes and change the path of joinNode to avoid them
    /// </summary>
    /// <param name="jointNode">input joinNode</param>
    _processJointNode(jointNode) {
      if (_SpiralTree._TooClose(jointNode.MChild, jointNode.PChild, config.overlapThreshold * 3)) {
        this._nodeKeeper.remove(jointNode.PChild);
        this._nodeKeeper.remove(jointNode.MChild);
        this._nodeKeeper.insert(jointNode);
      } else if (_SpiralTree._TooClose(jointNode, jointNode.PChild, config.overlapThreshold)) {
        this._replaceWithAuxCircleJointNode(jointNode.MChild, jointNode.PChild.radius, 1 /* Plus */);
      } else if (_SpiralTree._TooClose(jointNode, jointNode.MChild, config.overlapThreshold)) {
        this._replaceWithAuxCircleJointNode(jointNode.PChild, jointNode.MChild.radius, -1 /* Minus */);
      } else {
        this._nodeKeeper.remove(jointNode.PChild);
        this._nodeKeeper.remove(jointNode.MChild);
        this._nodeKeeper.insert(jointNode);
      }
    }
    _ensureNodeThetaUnique(node) {
      var smallAngle = 1e-9;
      var value = 0;
      value = this._duplicatedAngleChecker[node.theta];
      if (value != void 0) {
        this._duplicatedAngleChecker[node.theta] += smallAngle;
        node.theta += value;
      } else {
        this._duplicatedAngleChecker[node.theta] = smallAngle;
      }
    }
    static _IsValid(tPlus, tMinus, maxValue) {
      return tPlus * tMinus > 0 && tPlus < maxValue && tMinus < maxValue;
    }
    static _EnsureBetweenZeroAndTwoPi(theta) {
      while (theta > _SpiralTree._TWO_PI) {
        theta -= _SpiralTree._TWO_PI;
      }
      while (theta < 0) {
        theta += _SpiralTree._TWO_PI;
      }
      return theta;
    }
    static _TooClose(node1, node2, threshold) {
      return util.distance(node1, node2) <= threshold;
    }
  };
  _SpiralTree._TWO_PI = Math.PI * 2;
  var SpiralTree = _SpiralTree;
  var PathBuilder = class {
    constructor(tree) {
      this._spiral = null;
      this._nodes = null;
      this._fracs = null;
      this._spiral = tree;
      this._nodes = new EdgeSmoother(this._spiral).run();
      this._fracs = {};
      for (var self of this._nodes.offspring()) {
        var pare = this._nodes.parent(self);
        var gran = this._nodes.parent(pare);
        if (!pare || !gran) {
          continue;
        }
        var hits = [];
        for (var c of this._spiral.inRange([self, pare, gran])) {
          if (util.inTriangle(c, self, pare, gran)) {
            hits.push(c);
          }
        }
        var frac = config.defaultCurveFraction;
        if (hits.length != 0) {
          var dist = 0;
          for (var h of hits) {
            dist = Math.max(h.distance(self, gran), dist);
          }
          var pdistance = pare.distance(self, gran);
          if (dist < pdistance) {
            frac = Math.min(frac, 1 - dist / pare.distance(self, gran));
          }
        }
        this._fracs[self.nid] = frac;
      }
    }
    offspring(nid) {
      return this._nodes.offspring(nid).map((n) => n.nid);
    }
    subroots(keys) {
      return this._nodes.merge(keys);
    }
    ancestors(nid) {
      return this._nodes.ancestors(nid).map((n) => n.nid);
    }
    build() {
      var vectorOne = {};
      var vectorTwo = {};
      for (var self of this._nodes.offspring()) {
        var frac = this._fracs[self.nid];
        if (!frac) {
          continue;
        }
        var pare = this._nodes.parent(self);
        var gran = this._nodes.parent(pare);
        vectorOne[self.nid] = vector.scale(pare, self, frac);
        vectorTwo[pare.nid] = vector.scale(gran, pare, frac);
      }
      var result = [], offspring = this._nodes.offspring();
      var minusRotate = [0, 1, -1, 0], plusRotate = [0, -1, 1, 0];
      for (var i = 0, len = offspring.length; i < len; i++) {
        var self = offspring[i];
        var pare = this._nodes.parent(self);
        var gran = this._nodes.parent(pare);
        var path = result[i] = new FlowPath();
        path.nodes = [pare, self];
        path.id = self.nid;
        path.weights = [pare.weight, self.weight];
        path.leafs = self.leafs;
        if (self.type === NodeTypes.Leaf) {
          path.lineStart.key = self.key;
          path.lineStart.push(self.x, self.y);
        } else {
          var vec = vectorTwo[self.nid];
          path.lineStart.push(self.x - vec[0], self.y - vec[1]);
        }
        if (gran) {
          var selfSeg = vectorOne[self.nid];
          var pareSeg = vectorTwo[pare.nid];
          if (self.type === NodeTypes.Leaf) {
            path.lineEnd.push(self.x, self.y);
          } else {
            path.lineEnd.push(pare.x + selfSeg[0], pare.y + selfSeg[1]);
          }
          path.curveEnd.push(pare.x - pareSeg[0], pare.y - pareSeg[1]);
          path.curveCtl.push(pare.x, pare.y);
          var unit = vector.unit(gran, pare);
          if (isNaN(unit[0]) || isNaN(unit[1])) {
            unit = [1, 0];
          }
          path.offset = [
            unit[1] * plusRotate[2],
            unit[0] * plusRotate[1],
            0,
            self === pare.PChild ? 1 : -1
          ];
        } else {
          path.lineEnd.key = this._spiral.root.key;
          path.lineEnd.push(this._spiral.root.x, this._spiral.root.y);
          path.curveEnd = path.curveCtl = [];
        }
      }
      return result;
    }
    reweight(weight) {
      let info = {};
      let update = (n) => {
        let sum = 0;
        if (n.type === NodeTypes.Leaf) {
          sum += weight(n.key);
        } else {
          if (n.PChild) {
            if (n.PChild.nid in info) {
              sum += info[n.PChild.nid];
            } else {
              sum += update(n.PChild);
            }
          }
          if (n.MChild) {
            if (n.MChild.nid in info) {
              sum += info[n.MChild.nid];
            } else {
              sum += update(n.MChild);
            }
          }
        }
        n.weight = info[n.nid] = sum;
        return sum;
      };
      update(this._nodes.root);
    }
    visit(v) {
      if (this._nodes.root) {
        v(this._nodes.root);
      }
      for (var n of this._nodes.offspring()) {
        v(n);
      }
      return this;
    }
  };

  // code/src/lava/flowmap/arc.ts
  function arc(s, t, cnt) {
    return new GreatCircle(s, t, void 0).Arc(cnt).geometries[0].coords;
  }
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var Coord = function(lon, lat) {
    this.lon = lon;
    this.lat = lat;
    this.x = D2R * lon;
    this.y = D2R * lat;
  };
  Coord.prototype.view = function() {
    return String(this.lon).slice(0, 4) + "," + String(this.lat).slice(0, 4);
  };
  Coord.prototype.antipode = function() {
    var anti_lat = -1 * this.lat;
    var anti_lon = this.lon < 0 ? 180 + this.lon : (180 - this.lon) * -1;
    return new Coord(anti_lon, anti_lat);
  };
  var LineString = function() {
    this.coords = [];
    this.length = 0;
  };
  LineString.prototype.move_to = function(coord) {
    this.length++;
    this.coords.push(coord);
  };
  var Arc = function(properties) {
    this.properties = properties || {};
    this.geometries = [];
  };
  Arc.prototype.json = function() {
    if (this.geometries.length <= 0) {
      return {
        "geometry": { "type": "LineString", "coordinates": null },
        "type": "Feature",
        "properties": this.properties
      };
    } else if (this.geometries.length == 1) {
      return {
        "geometry": { "type": "LineString", "coordinates": this.geometries[0].coords },
        "type": "Feature",
        "properties": this.properties
      };
    } else {
      var multiline = [];
      for (var i = 0; i < this.geometries.length; i++) {
        multiline.push(this.geometries[i].coords);
      }
      return {
        "geometry": { "type": "MultiLineString", "coordinates": multiline },
        "type": "Feature",
        "properties": this.properties
      };
    }
  };
  Arc.prototype.wkt = function() {
    var wkt_string = "";
    var wkt = "LINESTRING(";
    var collect = function(c) {
      wkt += c[0] + " " + c[1] + ",";
    };
    for (var i = 0; i < this.geometries.length; i++) {
      if (this.geometries[i].coords.length === 0) {
        return "LINESTRING(empty)";
      } else {
        var coords = this.geometries[i].coords;
        coords.forEach(collect);
        wkt_string += wkt.substring(0, wkt.length - 1) + ")";
      }
    }
    return wkt_string;
  };
  var GreatCircle = function(start, end, properties) {
    if (!start || start.x === void 0 || start.y === void 0) {
      throw new Error("GreatCircle constructor expects two args: start and end objects with x and y properties");
    }
    if (!end || end.x === void 0 || end.y === void 0) {
      throw new Error("GreatCircle constructor expects two args: start and end objects with x and y properties");
    }
    this.start = new Coord(start.x, start.y);
    this.end = new Coord(end.x, end.y);
    this.properties = properties || {};
    var w = this.start.x - this.end.x;
    var h = this.start.y - this.end.y;
    var z = Math.pow(Math.sin(h / 2), 2) + Math.cos(this.start.y) * Math.cos(this.end.y) * Math.pow(Math.sin(w / 2), 2);
    this.g = 2 * Math.asin(Math.sqrt(z));
    if (this.g == Math.PI) {
      throw new Error("it appears " + start.view() + " and " + end.view() + " are 'antipodal', e.g diametrically opposite, thus there is no single route but rather infinite");
    } else if (isNaN(this.g)) {
      throw new Error("could not calculate great circle between " + start + " and " + end);
    }
  };
  GreatCircle.prototype.interpolate = function(f) {
    var A = Math.sin((1 - f) * this.g) / Math.sin(this.g);
    var B = Math.sin(f * this.g) / Math.sin(this.g);
    var x = A * Math.cos(this.start.y) * Math.cos(this.start.x) + B * Math.cos(this.end.y) * Math.cos(this.end.x);
    var y = A * Math.cos(this.start.y) * Math.sin(this.start.x) + B * Math.cos(this.end.y) * Math.sin(this.end.x);
    var z = A * Math.sin(this.start.y) + B * Math.sin(this.end.y);
    var lat = R2D * Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
    var lon = R2D * Math.atan2(y, x);
    return [lon, lat];
  };
  GreatCircle.prototype.Arc = function(npoints, options) {
    var first_pass = [];
    if (!npoints || npoints <= 2) {
      first_pass.push([this.start.lon, this.start.lat]);
      first_pass.push([this.end.lon, this.end.lat]);
    } else {
      var delta2 = 1 / (npoints - 1);
      for (var i = 0; i < npoints; ++i) {
        var step = delta2 * i;
        var pair2 = this.interpolate(step);
        first_pass.push(pair2);
      }
    }
    var bHasBigDiff = false;
    var dfMaxSmallDiffLong = 0;
    var dfDateLineOffset = options && options.offset ? options.offset : 10;
    var dfLeftBorderX = 180 - dfDateLineOffset;
    var dfRightBorderX = -180 + dfDateLineOffset;
    var dfDiffSpace = 360 - dfDateLineOffset;
    for (var j = 1; j < first_pass.length; ++j) {
      var dfPrevX = first_pass[j - 1][0];
      var dfX = first_pass[j][0];
      var dfDiffLong = Math.abs(dfX - dfPrevX);
      if (dfDiffLong > dfDiffSpace && (dfX > dfLeftBorderX && dfPrevX < dfRightBorderX || dfPrevX > dfLeftBorderX && dfX < dfRightBorderX)) {
        bHasBigDiff = true;
      } else if (dfDiffLong > dfMaxSmallDiffLong) {
        dfMaxSmallDiffLong = dfDiffLong;
      }
    }
    var poMulti = [];
    if (bHasBigDiff && dfMaxSmallDiffLong < dfDateLineOffset) {
      var poNewLS = [];
      poMulti.push(poNewLS);
      for (var k = 0; k < first_pass.length; ++k) {
        var dfX0 = parseFloat(first_pass[k][0]);
        if (k > 0 && Math.abs(dfX0 - first_pass[k - 1][0]) > dfDiffSpace) {
          var dfX1 = parseFloat(first_pass[k - 1][0]);
          var dfY1 = parseFloat(first_pass[k - 1][1]);
          var dfX2 = parseFloat(first_pass[k][0]);
          var dfY2 = parseFloat(first_pass[k][1]);
          if (dfX1 > -180 && dfX1 < dfRightBorderX && dfX2 == 180 && k + 1 < first_pass.length && first_pass[k - 1][0] > -180 && first_pass[k - 1][0] < dfRightBorderX) {
            poNewLS.push([-180, first_pass[k][1]]);
            k++;
            poNewLS.push([first_pass[k][0], first_pass[k][1]]);
            continue;
          } else if (dfX1 > dfLeftBorderX && dfX1 < 180 && dfX2 == -180 && k + 1 < first_pass.length && first_pass[k - 1][0] > dfLeftBorderX && first_pass[k - 1][0] < 180) {
            poNewLS.push([180, first_pass[k][1]]);
            k++;
            poNewLS.push([first_pass[k][0], first_pass[k][1]]);
            continue;
          }
          if (dfX1 < dfRightBorderX && dfX2 > dfLeftBorderX) {
            var tmpX = dfX1;
            dfX1 = dfX2;
            dfX2 = tmpX;
            var tmpY = dfY1;
            dfY1 = dfY2;
            dfY2 = tmpY;
          }
          if (dfX1 > dfLeftBorderX && dfX2 < dfRightBorderX) {
            dfX2 += 360;
          }
          if (dfX1 <= 180 && dfX2 >= 180 && dfX1 < dfX2) {
            var dfRatio = (180 - dfX1) / (dfX2 - dfX1);
            var dfY = dfRatio * dfY2 + (1 - dfRatio) * dfY1;
            poNewLS.push([first_pass[k - 1][0] > dfLeftBorderX ? 180 : -180, dfY]);
            poNewLS = [];
            poNewLS.push([first_pass[k - 1][0] > dfLeftBorderX ? -180 : 180, dfY]);
            poMulti.push(poNewLS);
          } else {
            poNewLS = [];
            poMulti.push(poNewLS);
          }
          poNewLS.push([dfX0, first_pass[k][1]]);
        } else {
          poNewLS.push([first_pass[k][0], first_pass[k][1]]);
        }
      }
    } else {
      var poNewLS0 = [];
      poMulti.push(poNewLS0);
      for (var l = 0; l < first_pass.length; ++l) {
        poNewLS0.push([first_pass[l][0], first_pass[l][1]]);
      }
    }
    var arc2 = new Arc(this.properties);
    for (var m = 0; m < poMulti.length; ++m) {
      var line = new LineString();
      arc2.geometries.push(line);
      var points = poMulti[m];
      for (var j0 = 0; j0 < points.length; ++j0) {
        line.move_to(points[j0]);
      }
    }
    return arc2;
  };
  return __toCommonJS(engine_entry_exports);
})();
