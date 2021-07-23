import * as htmlComponents from 'https://resources.realitymedia.digital/vue-apps/dist/hubs.js';

/**
 * Modified from https://github.com/mozilla/hubs/blob/master/src/components/fader.js
 * to include adjustable duration and converted from component to system
 */

AFRAME.registerSystem('fader-plus', {
  schema: {
    direction: { type: 'string', default: 'none' }, // "in", "out", or "none"
    duration: { type: 'number', default: 200 }, // Transition duration in milliseconds
    color: { type: 'color', default: 'white' },
  },

  init() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({
        color: this.data.color,
        side: THREE.BackSide,
        opacity: 0,
        transparent: true,
        fog: false,
      })
    );
    mesh.scale.x = mesh.scale.y = 1;
    mesh.scale.z = 0.15;
    mesh.matrixNeedsUpdate = true;
    mesh.renderOrder = 1; // render after other transparent stuff
    this.el.camera.add(mesh);
    this.mesh = mesh;
  },

  fadeOut() {
    return this.beginTransition('out')
  },

  fadeIn() {
    return this.beginTransition('in')
  },

  async beginTransition(direction) {
    if (this._resolveFinish) {
      throw new Error('Cannot fade while a fade is happening.')
    }

    this.el.setAttribute('fader-plus', { direction });

    return new Promise((res) => {
      if (this.mesh.material.opacity === (direction == 'in' ? 0 : 1)) {
        res();
      } else {
        this._resolveFinish = res;
      }
    })
  },

  tick(t, dt) {
    const mat = this.mesh.material;
    this.mesh.visible = this.data.direction === 'out' || mat.opacity !== 0;
    if (!this.mesh.visible) return

    if (this.data.direction === 'in') {
      mat.opacity = Math.max(0, mat.opacity - (1.0 / this.data.duration) * Math.min(dt, 50));
    } else if (this.data.direction === 'out') {
      mat.opacity = Math.min(1, mat.opacity + (1.0 / this.data.duration) * Math.min(dt, 50));
    }

    if (mat.opacity === 0 || mat.opacity === 1) {
      if (this.data.direction !== 'none') {
        if (this._resolveFinish) {
          this._resolveFinish();
          this._resolveFinish = null;
        }
      }

      this.el.setAttribute('fader-plus', { direction: 'none' });
    }
  },
});

const worldCamera$1 = new THREE.Vector3();
const worldSelf$1 = new THREE.Vector3();

AFRAME.registerComponent('proximity-events', {
  schema: {
    radius: { type: 'number', default: 1 },
  },
  init() {
    this.inZone = false;
    this.camera = this.el.sceneEl.camera;
  },
  tick() {
    this.camera.getWorldPosition(worldCamera$1);
    this.el.object3D.getWorldPosition(worldSelf$1);
    const wasInzone = this.inZone;
    this.inZone = worldCamera$1.distanceTo(worldSelf$1) < this.data.radius;
    if (this.inZone && !wasInzone) this.el.emit('proximityenter');
    if (!this.inZone && wasInzone) this.el.emit('proximityleave');
  },
});

const glsl$3 = `
varying vec2 vUv;
varying vec3 vRay;
varying vec3 vNormal;

void main() {
  vUv = uv;
  // vNormal = normalMatrix * normal;
  vec3 cameraLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vRay = position - cameraLocal;
  vNormal = normalize(-1. * vRay);
  float dist = length(cameraLocal);
  vRay.z *= 1.3 / (1. + pow(dist, 0.5)); // Change FOV by squashing local Z direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const glsl$2 = `
uniform samplerCube cubeMap;
uniform float time;
uniform float radius;
uniform vec3 ringColor;

varying vec2 vUv;
varying vec3 vRay;
varying vec3 vNormal;

#define RING_WIDTH 0.1
#define RING_HARD_OUTER 0.01
#define RING_HARD_INNER 0.08
#define forward vec3(0.0, 0.0, 1.0)

void main() {
  vec2 coord = vUv * 2.0 - 1.0;
  float noise = snoise(vec3(coord * 1., time)) * 0.5 + 0.5;

  // Polar distance
  float dist = length(coord);
  dist += noise * 0.2;

  float maskOuter = 1.0 - smoothstep(radius - RING_HARD_OUTER, radius, dist);
  float maskInner = 1.0 - smoothstep(radius - RING_WIDTH, radius - RING_WIDTH + RING_HARD_INNER, dist);
  float distortion = smoothstep(radius - 0.2, radius + 0.2, dist);
  vec3 normal = normalize(vNormal);
  float directView = smoothstep(0., 0.8, dot(normal, forward));
  vec3 tangentOutward = vec3(coord, 0.0);
  vec3 ray = mix(vRay, tangentOutward, distortion);
  vec4 texel = textureCube(cubeMap, ray);
  vec3 centerLayer = texel.rgb * maskInner;
  vec3 ringLayer = ringColor * (1. - maskInner);
  vec3 composite = centerLayer + ringLayer;

  gl_FragColor = vec4(composite, (maskOuter - maskInner) + maskInner * directView);
}
`;

/*
 * 3D Simplex noise
 * SIGNATURE: float snoise(vec3 v)
 * https://github.com/hughsk/glsl-noise
 */

const glsl$1 = `
//
// Description : Array and textureless GLSL 2D/3D/4D simplex
//               noise functions.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : ijm
//     Lastmod : 20110822 (ijm)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License. See LICENSE file.
//               https://github.com/ashima/webgl-noise
//

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
     return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v)
  {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

// First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

// Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

// Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// Gradients: 7x7 points over a square, mapped onto an octahedron.
// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

//Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

// Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
  }  
`;

// Provides a global registry of running components
// copied from hubs source

function registerComponentInstance(component, name) {
    window.APP.componentRegistry = window.APP.componentRegistry || {};
    window.APP.componentRegistry[name] = window.APP.componentRegistry[name] || [];
    window.APP.componentRegistry[name].push(component);
}

function deregisterComponentInstance(component, name) {
    if (!window.APP.componentRegistry || !window.APP.componentRegistry[name]) return;
    window.APP.componentRegistry[name].splice(window.APP.componentRegistry[name].indexOf(component), 1);
}

// copied from hubs

function findAncestorWithComponent(entity, componentName) {
    while (entity && !(entity.components && entity.components[componentName])) {
      entity = entity.parentNode;
    }
    return entity;
  }

/**
 * Description
 * ===========
 * break the room into quadrants of a certain size, and hide the contents of areas that have
 * nobody in them.  Media will be paused in those areas too.
 * 
 * Include a way for the portal component to turn on elements in the region of the portal before
 * it captures a cubemap
 */

 // arbitrarily choose 1000000 as the number of computed zones in  x and y
let MAX_ZONES = 1000000;
let regionTag = function(size, obj3d) {
    let pos = obj3d.position;
    let xp = Math.floor(pos.x / size) + MAX_ZONES/2;
    let zp = Math.floor(pos.z / size) + MAX_ZONES/2;
    return MAX_ZONES * xp + zp
};

let regionsInUse = [];

/**
 * Find the closest ancestor (including the passed in entity) that has an `object-region-follower` component,
 * and return that component
 */
function getRegionFollower(entity) {
    let curEntity = entity;
  
    while(curEntity && curEntity.components && !curEntity.components["object-region-follower"]) {
        curEntity = curEntity.parentNode;
    }
  
    if (!curEntity || !curEntity.components || !curEntity.components["object-region-follower"]) {
        return;
    }
    
    return curEntity.components["object-region-follower"]
}
  
function addToRegion(region) {
    regionsInUse[region] ? regionsInUse[region]++ : regionsInUse[region] = 1;
    console.log("Avatars in region " + region + ": " + regionsInUse[region]);
    if (regionsInUse[region] == 1) {
        showHideObjectsInRegion(region, true);
    } else {
        console.log("already another avatar in this region, no change");
    }
}

function subtractFromRegion(region) {
    if (regionsInUse[region]) {regionsInUse[region]--; }
    console.log("Avatars left region " + region + ": " + regionsInUse[region]);

    if (regionsInUse[region] == 0) {
        showHideObjectsInRegion(region, false);
    } else {
        console.log("still another avatar in this region, no change");
    }
}

function showRegionForObject(element) {
    let follower = getRegionFollower(element);
    if (!follower) { return }

    console.log("showing objects near " + follower.el.className);

    addToRegion(follower.region);
}

function hiderRegionForObject(element) {
    let follower = getRegionFollower(element);
    if (!follower) { return }

    console.log("hiding objects near " + follower.el.className);

    subtractFromRegion(follower.region);
}

function showHideObjects() {
    if (!window.APP || !window.APP.componentRegistry)
      return null;

    console.log ("showing/hiding all objects");
    const objects = window.APP.componentRegistry["object-region-follower"] || [];
  
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      
      let visible = regionsInUse[obj.region] ? true: false;
        
      if (obj.el.object3D.visible == visible) { continue }

      console.log ((visible ? "showing " : "hiding ") + obj.el.className);
      obj.showHide(visible);
    }
  
    return null;
}

function showHideObjectsInRegion(region, visible) {
    if (!window.APP || !window.APP.componentRegistry)
      return null;

    console.log ((visible ? "showing" : "hiding") + " all objects in region " + region);
    const objects = window.APP.componentRegistry["object-region-follower"] || [];
  
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      
      if (obj.region == region) {
        console.log ((visible ? "showing " : " hiding") + obj.el.className);
        obj.showHide(visible);
      }
    }
  
    return null;
}
  
AFRAME.registerComponent('avatar-region-follower', {
    schema: {
        size: { default: 10 }
    },
    init: function () {
        this.region = regionTag(this.data.size, this.el.object3D);
        console.log("Avatar: region ", this.region);
        addToRegion(this.region);

        registerComponentInstance(this, "avatar-region-follower");
    },
    remove: function() {
        deregisterComponentInstance(this, "avatar-region-follower");
        subtractFromRegion(this.region);
    },

    tick: function () {
        let newRegion = regionTag(this.data.size, this.el.object3D);
        if (newRegion != this.region) {
            subtractFromRegion(this.region);
            addToRegion(newRegion);
            this.region = newRegion;
        }
    },
});

AFRAME.registerComponent('object-region-follower', {
    schema: {
        size: { default: 10 },
        dynamic: { default: true }
    },
    init: function () {
        this.region = regionTag(this.data.size, this.el.object3D);

        this.showHide = this.showHide.bind(this);
        if (this.el.components["media-video"]) {
            this.wasPaused = this.el.components["media-video"].data.videoPaused;
        }
        registerComponentInstance(this, "object-region-follower");
    },

    remove: function() {
        deregisterComponentInstance(this, "object-region-follower");
    },

    tick: function () {
        // objects in the environment scene don't move
        if (!this.data.dynamic) { return }

        this.region = regionTag(this.data.size, this.el.object3D);

        let visible = regionsInUse[this.region] ? true: false;
        
        if (this.el.object3D.visible == visible) { return }

        // handle show/hiding the objects
        this.showHide(visible);
    },

    showHide: function (visible) {
        // handle show/hiding the objects
        this.el.object3D.visible = visible;

        /// check for media-video component on parent to see if we're a video.  Also same for audio
        if (this.el.components["media-video"]) {
            if (visible) {
                if (this.wasPaused != this.el.components["media-video"].data.videoPaused) {
                    this.el.components["media-video"].togglePlaying();
                }
            } else {
                this.wasPaused = this.el.components["media-video"].data.videoPaused;
                if (!this.wasPaused) {
                    this.el.components["media-video"].togglePlaying();
                }
            }
        }
    }
});

AFRAME.registerComponent('region-hider', {
    schema: {
        // name must follow the pattern "*_componentName"
        size: { default: 10 }
    },
    init: function () {
        // If there is a parent with "nav-mesh-helper", this is in the scene.  
        // If not, it's in an object we dropped on the window, which we don't support
        if (!findAncestorWithComponent(this.el, "nav-mesh-helper")) {
            console.warn("region-hider component must be in the environment scene glb.");
            this.size = 0;
            return;
        }
        
        this.nodeName = this.el.parentEl.parentEl.className;
        if(this.data.size == 0) {
            this.data.size = 10;
        }
        this.size = this.parseNodeName(this.data.size);

        // this.newScene = this.newScene.bind(this)
        // this.el.sceneEl.addEventListener("environment-scene-loaded", this.newScene)
        // const environmentScene = document.querySelector("#environment-scene");
        // this.addSceneElement = this.addSceneElement.bind(this)
        // this.removeSceneElement = this.removeSceneElement.bind(this)
        // environmentScene.addEventListener("child-attached", this.addSceneElement)
        // environmentScene.addEventListener("child-detached", this.removeSceneElement)

        // we want to notice when new things get added to the room.  This will happen for
        // objects dropped in the room, or for new remote avatars, at least
        // this.addRootElement = this.addRootElement.bind(this)
        // this.removeRootElement = this.removeRootElement.bind(this)
        // this.el.sceneEl.addEventListener("child-attached", this.addRootElement)
        // this.el.sceneEl.addEventListener("child-detached", this.removeRootElement)

        // want to see if there are pinned objects that were loaded from hubs
        let roomObjects = document.getElementsByClassName("RoomObjects");
        this.roomObjects = roomObjects.length > 0 ? roomObjects[0] : null;

        // get avatars
        const avatars = this.el.sceneEl.querySelectorAll("[player-info]");
        avatars.forEach((avatar) => {
            avatar.setAttribute("avatar-region-follower", { size: this.size });
        });

        // walk objects in the root (things that have been dropped on the scene)
        // - drawings have class="drawing", networked-drawing
        // Not going to do drawings right now.

        // pinned media live under a node with class="RoomObjects"
        var nodes = this.el.sceneEl.querySelectorAll(".RoomObjects > [media-loader]");
        nodes.forEach((node) => {
            node.setAttribute("object-region-follower", { size: this.size });
        });

        // - camera has camera-tool        
        // - image from camera, or dropped, has media-loader, media-image, listed-media
        // - glb has media-loader, gltf-model-plus, listed-media
        // - video has media-loader, media-video, listed-media
        //
        //  so, get all camera-tools, and media-loader objects at the top level of the scene
        nodes = this.el.sceneEl.querySelectorAll("[camera-tool], a-scene > [media-loader]");
        nodes.forEach((node) => {
            node.setAttribute("object-region-follower", { size: this.size });
        });

        nodes = this.el.sceneEl.querySelectorAll("[camera-tool]");
        nodes.forEach((node) => {
            node.setAttribute("object-region-follower", { size: this.size });
        });

        // walk the objects in the environment scene.  Must wait for scene to finish loading
        this.sceneLoaded = this.sceneLoaded.bind(this);
        this.el.sceneEl.addEventListener("environment-scene-loaded", this.sceneLoaded);

    },

    // Things we don't want to hide:
    // - [waypoint]
    // - parent of something with [navmesh] as a child (this is the navigation stuff
    // - this.el.parentEl.parentEl
    // - [skybox]
    // - [directional-light]
    // - [ambient-light]
    // - [hemisphere-light]
    // - #CombinedMesh
    // - #scene-preview-camera or [scene-preview-camera]
    //
    // we will do
    // - [media-loader]
    // - [spot-light]
    // - [point-light]
    sceneLoaded: function () {
        var nodes = this.el.parentEl.parentEl.parentEl.childNodes;
        for (let i=0; i < nodes.length; i++) {
            let node = nodes[i];
            if (node == this.el.parentEl.parentEl) {continue}

            let cl = node.className;
            if (cl === "CombinedMesh" || cl === "scene-preview-camera") {continue}

            let c = node.components;
            if (c["waypoint"] || c["skybox"] || c["directional-light"] || c["ambient-light"] || c["hemisphere-light"]) {continue}

            let ch = node.children;
            var navmesh = false;
            for (let j=0; j < ch.length; j++) {
                if (ch[j].components["navmesh"]) {
                    navmesh = true;
                    break;
                }
            }
            if (navmesh) {continue}
            
            node.setAttribute("object-region-follower", { size: this.size, dynamic: false });
        }

        // all objects and avatar should be set up, so lets make sure all objects are correctly shown
        showHideObjects();
    },

    update: function () {
        if (this.data.size == 0) {this.data.size = 10;}
        if (this.data.size === this.size) return

        this.size = this.parseNodeName(this.data.size);
    },

    remove: function () {
        this.el.sceneEl.removeEventListener("environment-scene-loaded", this.sceneLoaded);
    },

    // per frame stuff
    tick: function (time) {
        // size == 0 is used to signal "do nothing"
        if (this.size == 0) {return}

        // see if there are new avatars
        var nodes = this.el.sceneEl.querySelectorAll("[player-info]:not([avatar-region-follower])");
        nodes.forEach((avatar) => {
            avatar.setAttribute("avatar-region-follower", { size: this.size });
        });

        //  see if there are new camera-tools or media-loader objects at the top level of the scene
        nodes = this.el.sceneEl.querySelectorAll("[camera-tool]:not([object-region-follower]), a-scene > [media-loader]:not([object-region-follower])");
        nodes.forEach((node) => {
            node.setAttribute("object-region-follower", { size: this.size });
        });
    },
  
    // newScene: function(model) {
    //     console.log("environment scene loaded: ", model)
    // },

    // addRootElement: function({ detail: { el } }) {
    //     console.log("entity added to root: ", el)
    // },

    // removeRootElement: function({ detail: { el } }) {
    //     console.log("entity removed from root: ", el)
    // },

    // addSceneElement: function({ detail: { el } }) {
    //     console.log("entity added to environment scene: ", el)
    // },

    // removeSceneElement: function({ detail: { el } }) {
    //     console.log("entity removed from environment scene: ", el)
    // },  
    
    parseNodeName: function (size) {
        // nodes should be named anything at the beginning with 
        //  "size" (an integer number)
        // at the very end.  This will set the hidder component to 
        // use that size in meters for the quadrants
        const params = this.nodeName.match(/_([0-9]*)$/);

        // if pattern matches, we will have length of 2, first match is the dir,
        // second is the componentName name or number
        if (!params || params.length < 2) {
            console.warn("region-hider componentName not formatted correctly: ", this.nodeName);
            return size
        } else {
            let nodeSize = parseInt(params[1]);
            if (!nodeSize) {
                return size
            } else {
                return nodeSize
            }
        }
    }
});

/**
 * Description
 * ===========
 * Bidirectional see-through portal. Two portals are paired by color.
 *
 * Usage
 * =======
 * Add two instances of `portal.glb` to the Spoke scene.
 * The name of each instance should look like "some-descriptive-label__color"
 * Any valid THREE.Color argument is a valid color value.
 * See here for example color names https://www.w3schools.com/cssref/css_colors.asp
 *
 * For example, to make a pair of connected blue portals,
 * you could name them "portal-to__blue" and "portal-from__blue"
 */

const worldPos = new THREE.Vector3();
const worldCameraPos = new THREE.Vector3();
const worldDir = new THREE.Vector3();
const worldQuat = new THREE.Quaternion();
const mat4 = new THREE.Matrix4();

AFRAME.registerSystem('portal', {
  dependencies: ['fader-plus'],
  init: function () {
    this.teleporting = false;
    this.characterController = this.el.systems['hubs-systems'].characterController;
    this.fader = this.el.systems['fader-plus'];
    this.roomData = null;
    this.waitForFetch = this.waitForFetch.bind(this);

    // if the user is logged in, we want to retrieve their userData from the top level server
    if (window.APP.store.state.credentials && window.APP.store.state.credentials.token && !window.APP.userData) {
        this.fetchRoomData();
    }
  },
  fetchRoomData: async function () {
    var params = {token: window.APP.store.state.credentials.token,
                  room_id: window.APP.hubChannel.hubId};

    const options = {};
    options.headers = new Headers();
    options.headers.set("Authorization", `Bearer ${params}`);
    options.headers.set("Content-Type", "application/json");
    await fetch("https://realitymedia.digital/userData", options)
        .then(response => response.json())
        .then(data => {
          console.log('Success:', data);
          this.roomData = data;
    });
    this.roomData.textures = [];
  },
  getRoomURL: async function (number) {
      this.waitForFetch();
      return this.roomData.rooms.length > number ? "https://xr.realitymedia.digital/" + this.roomData.rooms[number] : null;
  },
  getCubeMap: async function (number) {
      this.waitForFetch();
      return this.roomData.cubemaps.length > number ? this.roomData.cubemaps[number] : null;
  },
  waitForFetch: function () {
     if (this.roomData) return
     setTimeout(this.waitForFetch, 100); // try again in 100 milliseconds
  },
  teleportTo: async function (object) {
    this.teleporting = true;
    await this.fader.fadeOut();
    // Scale screws up the waypoint logic, so just send position and orientation
    object.getWorldQuaternion(worldQuat);
    object.getWorldDirection(worldDir);
    object.getWorldPosition(worldPos);
    worldPos.add(worldDir.multiplyScalar(1.5)); // Teleport in front of the portal to avoid infinite loop
    mat4.makeRotationFromQuaternion(worldQuat);
    mat4.setPosition(worldPos);
    // Using the characterController ensures we don't stray from the navmesh
    this.characterController.travelByWaypoint(mat4, true, false);
    await this.fader.fadeIn();
    this.teleporting = false;
  },
});

AFRAME.registerComponent('portal', {
  schema: {
    color: { type: 'color', default: null },
  },
  init: async function () {
    this.system = APP.scene.systems.portal; // A-Frame is supposed to do this by default but doesn't?

    // parse the name to get portal type, target, and color
    this.parseNodeName();

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        cubeMap: { value: new THREE.Texture() },
        time: { value: 0 },
        radius: { value: 0 },
        ringColor: { value: this.color },
      },
      vertexShader: glsl$3,
      fragmentShader: `
        ${glsl$1}
        ${glsl$2}
      `,
    });

    // Assume that the object has a plane geometry
    const mesh = this.el.getOrCreateObject3D('mesh');
    mesh.material = this.material;

    // get the other before continuing
    this.other = await this.getOther();

    if (this.portalType == 1) {
        this.system.getCubeMap(this.portalTarget).then( urls => {
            //const urls = [cubeMapPosX, cubeMapNegX, cubeMapPosY, cubeMapNegY, cubeMapPosZ, cubeMapNegZ];
            new Promise((resolve, reject) =>
              new THREE.CubeTextureLoader().load(urls, resolve, undefined, reject)
            ).then(texture => {
                texture.format = THREE.RGBFormat;
                this.material.uniforms.cubeMap.value = texture;
            }).catch(e => console.error(e));    
        });
    } else if (this.portalType == 2) {    
        this.cubeCamera = new THREE.CubeCamera(1, 100000, 1024);
        this.cubeCamera.rotateY(Math.PI); // Face forwards
        this.el.object3D.add(this.cubeCamera);
        this.other.components.portal.material.uniforms.cubeMap.value = this.cubeCamera.renderTarget.texture;
        this.el.sceneEl.addEventListener('model-loaded', () => {
            showRegionForObject(this.el);
            this.cubeCamera.update(this.el.sceneEl.renderer, this.el.sceneEl.object3D);
            hiderRegionForObject(this.el);
        });
    }

    this.el.setAttribute('animation__portal', {
        property: 'components.portal.material.uniforms.radius.value',
        dur: 700,
        easing: 'easeInOutCubic',
    });
    this.el.addEventListener('animationbegin', () => (this.el.object3D.visible = true));
    this.el.addEventListener('animationcomplete__portal', () => (this.el.object3D.visible = !this.isClosed()));

    // going to want to try and make the object this portal is on clickable
    this.el.setAttribute('is-remote-hover-target','');
    this.el.setAttribute('tags', {singleActionButton: true});
    this.el.setAttribute('class', "interactable");
    // orward the 'interact' events to our portal movement 
    this.followPortal = this.followPortal.bind(this);
    this.el.object3D.addEventListener('interact', this.followPortal);

    this.el.setAttribute('proximity-events', { radius: 5 });
    this.el.addEventListener('proximityenter', () => this.open());
    this.el.addEventListener('proximityleave', () => this.close());
  },

  followPortal: function() {
    if (this.portalType == 1) {
        console.log("set window.location.href to " + this.other);
        window.location.href = this.other;
      } else if (this.portalType == 2) {
        this.system.teleportTo(this.other.object3D);
      }
  },
  tick: function (time) {
    this.material.uniforms.time.value = time / 1000;
        
    if (this.other && !this.system.teleporting) {
      this.el.object3D.getWorldPosition(worldPos);
      this.el.sceneEl.camera.getWorldPosition(worldCameraPos);
      const dist = worldCameraPos.distanceTo(worldPos);

      if (this.portalType == 1 && dist < 0.5) ; else if (this.portalType == 2 && dist < 1) {
        this.system.teleportTo(this.other.object3D);
      }
    }
  },
  getOther: function () {
    return new Promise((resolve) => {
        if (this.portalType == 0) resolve(null);
        if (this.portalType  == 1) {
            // the target is another room, resolve with the URL to the room
            this.system.getRoomURL(this.portalTarget).then(url => { resolve(url); });
        }

        // now find the portal within the room.  The portals should come in pairs with the same portalTarget
        const portals = Array.from(document.querySelectorAll(`[portal]`));
        const other = portals.find((el) => el.components.portal.portalType == this.portalType &&
                                           el.components.portal.portalTarget === this.portalTarget && el !== this.el);
        if (other !== undefined) {
            // Case 1: The other portal already exists
            resolve(other);
            other.emit('pair', { other: this.el }); // Let the other know that we're ready
        } else {
            // Case 2: We couldn't find the other portal, wait for it to signal that it's ready
            this.el.addEventListener('pair', (event) => resolve(event.detail.other), { once: true });
        }
    })
  },

  parseNodeName: function () {
    const nodeName = this.el.parentEl.parentEl.className;

    // nodes should be named anything at the beginning with either 
    // - "room_name_color"
    // - "portal_N_color" 
    // at the very end. Numbered portals should come in pairs.
    const params = nodeName.match(/([A-Za-z]*)_([A-Za-z0-9]*)_([A-Za-z0-9]*)$/);
    
    // if pattern matches, we will have length of 4, first match is the portal type,
    // second is the name or number, and last is the color
    if (!params || params.length < 4) {
        console.warn("portal node name not formed correctly: ", nodeName);
        this.portalType = 0;
        this.portalTarget = null;
        this.color = "red"; // default so the portal has a color to use
        return;
    } 
    if (params[1] === "room") {
        this.portalType = 1;
        this.portalTarget = parseInt(params[2]);
    } else if (params[1] === "portal") {
        this.portalType = 2;
        this.portalTarget = params[2];
    } else {
        this.portalType = 0;
        this.portalTarget = null;
    } 
    this.color = new THREE.Color(params[3]);
  },

  setRadius(val) {
    this.el.setAttribute('animation__portal', {
      from: this.material.uniforms.radius.value,
      to: val,
    });
  },
  open() {
    this.setRadius(1);
  },
  close() {
    this.setRadius(0);
  },
  isClosed() {
    return this.material.uniforms.radius.value === 0
  },
});

/**
 * Description
 * ===========
 * 360 image that fills the user's vision when in a close proximity.
 *
 * Usage
 * =======
 * Given a 360 image asset with the following URL in Spoke:
 * https://gt-ael-aq-assets.aelatgt-internal.net/files/12345abc-6789def.jpg
 *
 * The name of the `immersive-360.glb` instance in the scene should be:
 * "some-descriptive-label__12345abc-6789def_jpg" OR "12345abc-6789def_jpg"
 */

const worldCamera = new THREE.Vector3();
const worldSelf = new THREE.Vector3();

AFRAME.registerComponent('immersive-360', {
  schema: {
    url: { type: 'string', default: null },
  },
  init: async function () {
    const url = this.data.url ?? this.parseSpokeName();
    const extension = url.match(/^.*\.(.*)$/)[1];

    // media-image will set up the sphere geometry for us
    this.el.setAttribute('media-image', {
      projection: '360-equirectangular',
      alphaMode: 'opaque',
      src: url,
      version: 1,
      batch: false,
      contentType: `image/${extension}`,
      alphaCutoff: 0,
    });
    // but we need to wait for this to happen
    this.mesh = await this.getMesh();
    this.mesh.geometry.scale(100, 100, 100);
    this.mesh.material.setValues({
      transparent: true,
      depthTest: false,
    });
    this.near = 1;
    this.far = 1.3;

    // Render OVER the scene but UNDER the cursor
    this.mesh.renderOrder = APP.RENDER_ORDER.CURSOR - 1;
  },
  tick: function () {
    if (this.mesh) {
      // Linearly map camera distance to material opacity
      this.mesh.getWorldPosition(worldSelf);
      this.el.sceneEl.camera.getWorldPosition(worldCamera);
      const distance = worldSelf.distanceTo(worldCamera);
      const opacity = 1 - (distance - this.near) / (this.far - this.near);
      this.mesh.material.opacity = opacity;
    }
  },
  parseSpokeName: function () {
    // Accepted names: "label__image-hash_ext" OR "image-hash_ext"
    const spokeName = this.el.parentEl.parentEl.className;
    const [, hash, extension] = spokeName.match(/(?:.*__)?(.*)_(.*)/);
    const url = `https://gt-ael-aq-assets.aelatgt-internal.net/files/${hash}.${extension}`;
    return url
  },
  getMesh: async function () {
    return new Promise((resolve) => {
      const mesh = this.el.object3DMap.mesh;
      if (mesh) resolve(mesh);
      this.el.addEventListener(
        'image-loaded',
        () => {
          resolve(this.el.object3DMap.mesh);
        },
        { once: true }
      );
    })
  },
});

// Parallax Occlusion shaders from
//    http://sunandblackcat.com/tipFullView.php?topicid=28
// No tangent-space transforms logic based on
//   http://mmikkelsen3d.blogspot.sk/2012/02/parallaxpoc-mapping-and-no-tangent.html

// Identity function for glsl-literal highlighting in VS Code
const glsl = String.raw;

const ParallaxShader = {
  // Ordered from fastest to best quality.
  modes: {
    none: 'NO_PARALLAX',
    basic: 'USE_BASIC_PARALLAX',
    steep: 'USE_STEEP_PARALLAX',
    occlusion: 'USE_OCLUSION_PARALLAX', // a.k.a. POM
    relief: 'USE_RELIEF_PARALLAX',
  },

  uniforms: {
    bumpMap: { value: null },
    map: { value: null },
    parallaxScale: { value: null },
    parallaxMinLayers: { value: null },
    parallaxMaxLayers: { value: null },
  },

  vertexShader: glsl`
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;

    void main() {
      vUv = uv;
      vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
      vViewPosition = -mvPosition.xyz;
      vNormal = normalize( normalMatrix * normal );
      
      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: glsl`
    uniform sampler2D bumpMap;
    uniform sampler2D map;

    uniform float parallaxScale;
    uniform float parallaxMinLayers;
    uniform float parallaxMaxLayers;
    uniform float fade; // CUSTOM

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;

    #ifdef USE_BASIC_PARALLAX

    vec2 parallaxMap(in vec3 V) {
      float initialHeight = texture2D(bumpMap, vUv).r;

      // No Offset Limitting: messy, floating output at grazing angles.
      //"vec2 texCoordOffset = parallaxScale * V.xy / V.z * initialHeight;",

      // Offset Limiting
      vec2 texCoordOffset = parallaxScale * V.xy * initialHeight;
      return vUv - texCoordOffset;
    }

    #else

    vec2 parallaxMap(in vec3 V) {
      // Determine number of layers from angle between V and N
      float numLayers = mix(parallaxMaxLayers, parallaxMinLayers, abs(dot(vec3(0.0, 0.0, 1.0), V)));

      float layerHeight = 1.0 / numLayers;
      float currentLayerHeight = 0.0;
      // Shift of texture coordinates for each iteration
      vec2 dtex = parallaxScale * V.xy / V.z / numLayers;

      vec2 currentTextureCoords = vUv;

      float heightFromTexture = texture2D(bumpMap, currentTextureCoords).r;

      // while ( heightFromTexture > currentLayerHeight )
      // Infinite loops are not well supported. Do a "large" finite
      // loop, but not too large, as it slows down some compilers.
      for (int i = 0; i < 30; i += 1) {
        if (heightFromTexture <= currentLayerHeight) {
          break;
        }
        currentLayerHeight += layerHeight;
        // Shift texture coordinates along vector V
        currentTextureCoords -= dtex;
        heightFromTexture = texture2D(bumpMap, currentTextureCoords).r;
      }

      #ifdef USE_STEEP_PARALLAX

      return currentTextureCoords;

      #elif defined(USE_RELIEF_PARALLAX)

      vec2 deltaTexCoord = dtex / 2.0;
      float deltaHeight = layerHeight / 2.0;

      // Return to the mid point of previous layer
      currentTextureCoords += deltaTexCoord;
      currentLayerHeight -= deltaHeight;

      // Binary search to increase precision of Steep Parallax Mapping
      const int numSearches = 5;
      for (int i = 0; i < numSearches; i += 1) {
        deltaTexCoord /= 2.0;
        deltaHeight /= 2.0;
        heightFromTexture = texture2D(bumpMap, currentTextureCoords).r;
        // Shift along or against vector V
        if (heightFromTexture > currentLayerHeight) {
          // Below the surface

          currentTextureCoords -= deltaTexCoord;
          currentLayerHeight += deltaHeight;
        } else {
          // above the surface

          currentTextureCoords += deltaTexCoord;
          currentLayerHeight -= deltaHeight;
        }
      }
      return currentTextureCoords;

      #elif defined(USE_OCLUSION_PARALLAX)

      vec2 prevTCoords = currentTextureCoords + dtex;

      // Heights for linear interpolation
      float nextH = heightFromTexture - currentLayerHeight;
      float prevH = texture2D(bumpMap, prevTCoords).r - currentLayerHeight + layerHeight;

      // Proportions for linear interpolation
      float weight = nextH / (nextH - prevH);

      // Interpolation of texture coordinates
      return prevTCoords * weight + currentTextureCoords * (1.0 - weight);

      #else // NO_PARALLAX

      return vUv;

      #endif
    }
    #endif

    vec2 perturbUv(vec3 surfPosition, vec3 surfNormal, vec3 viewPosition) {
      vec2 texDx = dFdx(vUv);
      vec2 texDy = dFdy(vUv);

      vec3 vSigmaX = dFdx(surfPosition);
      vec3 vSigmaY = dFdy(surfPosition);
      vec3 vR1 = cross(vSigmaY, surfNormal);
      vec3 vR2 = cross(surfNormal, vSigmaX);
      float fDet = dot(vSigmaX, vR1);

      vec2 vProjVscr = (1.0 / fDet) * vec2(dot(vR1, viewPosition), dot(vR2, viewPosition));
      vec3 vProjVtex;
      vProjVtex.xy = texDx * vProjVscr.x + texDy * vProjVscr.y;
      vProjVtex.z = dot(surfNormal, viewPosition);

      return parallaxMap(vProjVtex);
    }

    void main() {
      vec2 mapUv = perturbUv(-vViewPosition, normalize(vNormal), normalize(vViewPosition));
      
      // CUSTOM START
      vec4 texel = texture2D(map, mapUv);
      vec3 color = mix(texel.xyz, vec3(0), fade);
      gl_FragColor = vec4(color, 1.0);
      // CUSTOM END
    }

  `,
};

/**
 * Description
 * ===========
 * Create the illusion of depth in a color image from a depth map
 *
 * Usage
 * =====
 * Create a plane in Blender and give it a material (just the default Principled BSDF).
 * Assign color image to "color" channel and depth map to "emissive" channel.
 * You may want to set emissive strength to zero so the preview looks better.
 * Add the "parallax" component from the Hubs extension, configure, and export as .glb
 */

const vec = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, 1);

AFRAME.registerComponent('parallax', {
  schema: {
    strength: { type: 'number', default: 0.5 },
    cutoffTransition: { type: 'number', default: Math.PI / 8 },
    cutoffAngle: { type: 'number', default: Math.PI / 4 },
  },
  init: function () {
    const mesh = this.el.object3DMap.mesh;
    const { map: colorMap, emissiveMap: depthMap } = mesh.material;
    colorMap.wrapS = colorMap.wrapT = THREE.ClampToEdgeWrapping;
    depthMap.wrapS = depthMap.wrapT = THREE.ClampToEdgeWrapping;
    const { vertexShader, fragmentShader } = ParallaxShader;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: { USE_OCLUSION_PARALLAX: true },
      uniforms: {
        map: { value: colorMap },
        bumpMap: { value: depthMap },
        parallaxScale: { value: -1 * this.data.strength },
        parallaxMinLayers: { value: 20 },
        parallaxMaxLayers: { value: 30 },
        fade: { value: 0 },
      },
    });
    mesh.material = this.material;
  },
  tick() {
    if (this.el.sceneEl.camera) {
      this.el.sceneEl.camera.getWorldPosition(vec);
      this.el.object3D.worldToLocal(vec);
      const angle = vec.angleTo(forward);
      const fade = mapLinearClamped(
        angle,
        this.data.cutoffAngle - this.data.cutoffTransition,
        this.data.cutoffAngle + this.data.cutoffTransition,
        0, // In view zone, no fade
        1 // Outside view zone, full fade
      );
      this.material.uniforms.fade.value = fade;
    }
  },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mapLinear(x, a1, a2, b1, b2) {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1)
}

function mapLinearClamped(x, a1, a2, b1, b2) {
  return clamp(mapLinear(x, a1, a2, b1, b2), b1, b2)
}

/**
 * Description
 * ===========
 * create a HTML object by rendering a script that creates and manages it
 *
 */

// var htmlComponents;
// var scriptPromise;
// if (window.__testingVueApps) {
//     scriptPromise = import(window.__testingVueApps)    
// } else {
//     scriptPromise = import("https://resources.realitymedia.digital/vue-apps/dist/hubs.js") 
// }
// // scriptPromise = scriptPromise.then(module => {
// //     return module
// // });
/**
 * Modified from https://github.com/mozilla/hubs/blob/master/src/components/fader.js
 * to include adjustable duration and converted from component to system
 */

 AFRAME.registerSystem('html-script', {  
    init() {
        this.systemTick = htmlComponents["systemTick"];
        this.initializeEthereal = htmlComponents["initializeEthereal"];
        if (!this.systemTick || !this.initializeEthereal) {
            console.error("error in html-script system: htmlComponents has no systemTick and/or initializeEthereal methods");
        } else {
            this.initializeEthereal();
        }
    },
  
    tick(t, dt) {
        this.systemTick(t, dt);
    },
  });
  

AFRAME.registerComponent('html-script', {
    schema: {
        // name must follow the pattern "*_componentName"
        name: { type: "string", default: ""}
    },
    init: function () {
        this.script = null;
        this.fullName = this.data.name;
        this.parseNodeName();
        this.createScript();
    },

    update: function () {
        if (this.data.name === "" || this.data.name === this.fullName) return

        this.fullName = this.data.name;
        this.parseNodeName();

        if (this.script) {
            this.destroyScript();
        }
        this.createScript();
    },

    createScript: function () {
        // each time we load a script component we will possibly create
        // a new networked component.  This is fine, since the networked Id 
        // is based on the full name passed as a parameter, or assigned to the
        // component in Spoke.  It does mean that if we have
        // multiple objects in the scene which have the same name, they will
        // be in sync.  It also means that if you want to drop a component on
        // the scene via a .glb, it must have a valid name parameter inside it.
        // A .glb in spoke will fall back to the spoke name if you use one without
        // a name inside it.
        this.loadScript().then( () => {
            if (!this.script) return

            if (this.script.isNetworked) {
                // get the parent networked entity, when it's finished initializing.  
                // When creating this as part of a GLTF load, the 
                // parent a few steps up will be networked.  We'll only do this
                // if the HTML script wants to be networked
                this.netEntity = null;

                // bind callbacks
                this.getSharedData = this.getSharedData.bind(this);
                this.takeOwnership = this.takeOwnership.bind(this);
                this.setSharedData = this.setSharedData.bind(this);

                this.script.setNetworkMethods(this.takeOwnership, this.setSharedData);
            }

            // set up the local content and hook it to the scene
            const scriptEl = document.createElement('a-entity');
            this.simpleContainer = scriptEl;
            this.simpleContainer.object3D.matrixAutoUpdate = true;
            this.simpleContainer.setObject3D("weblayer3d", this.script.webLayer3D);

            // lets figure out the scale, but scaling to fill the a 1x1m square, that has also
            // potentially been scaled by the parents parent node. If we scale the entity in spoke,
            // this is where the scale is set.  If we drop a node in and scale it, the scale is also
            // set there.
            // We used to have a fixed size passed back from the entity, but that's too restrictive:
            // const width = this.script.width
            // const height = this.script.height

            var parent2 = this.el.parentEl.parentEl.object3D;
            var width = parent2.scale.x;
            var height = parent2.scale.y;
            parent2.scale.x = 1;
            parent2.scale.y = 1;
            parent2.scale.z = 1;

            if (width && width > 0 && height && height > 0) {
                const {width: wsize, height: hsize} = this.script.getSize();
                var scale = Math.min(width / wsize, height / hsize);
                this.simpleContainer.setAttribute("scale", { x: scale, y: scale, z: scale});
            }

            // there will be one element already, the cube we created in blender
            // and attached this component to, so remove it if it is there.
            // this.el.object3D.children.pop()
            for (const c of this.el.object3D.children) {
                c.visible = false;
            }

            // make sure "isStatic" is correct;  can't be static if either interactive or networked
            if (this.script.isStatic && (this.script.isInteractive || this.script.isNetworked)) {
                this.script.isStatic = false;
            }
                        
            // add in our container
            this.el.appendChild(this.simpleContainer);

            if (this.script.isInteractive) {
                // make the html object clickable
                this.simpleContainer.setAttribute('is-remote-hover-target','');
                this.simpleContainer.setAttribute('tags', {singleActionButton: true});
                this.simpleContainer.setAttribute('class', "interactable");

                // forward the 'interact' events to our object 
                this.clicked = this.clicked.bind(this);
                this.simpleContainer.object3D.addEventListener('interact', this.clicked);

                if (this.script.isDraggable) {
                    // we aren't going to really deal with this till we have a use case, but
                    // we can set it up for now
                    this.simpleContainer.setAttribute('tags', {singleActionButton: true, 
                        isHoldable: true,  holdableButton: true});
    
                    this.simpleContainer.object3D.addEventListener('holdable-button-down', (evt) => {
                        this.script.dragStart(evt);
                    });
                    this.simpleContainer.object3D.addEventListener('holdable-button-up', (evt) => {
                        this.script.dragEnd(evt);
                    });
                }

                //this.raycaster = new THREE.Raycaster()
                this.hoverRayL = new THREE.Ray();
                this.hoverRayR = new THREE.Ray();
            }
            if (this.script.isNetworked) {
                // This function finds an existing copy of the Networked Entity (if we are not the
                // first client in the room it will exist in other clients and be created by NAF)
                // or create an entity if we are first.
                this.setupNetworkedEntity = function (networkedEl) {
                    var persistent = true;
                    var netId;
                    if (networkedEl) {
                        // We will be part of a Networked GLTF if the GLTF was dropped on the scene
                        // or pinned and loaded when we enter the room.  Use the networked parents
                        // networkId plus a disambiguating bit of text to create a unique Id.
                        netId = NAF.utils.getNetworkId(networkedEl) + "-html-script";

                        // if we need to create an entity, use the same persistence as our
                        // network entity (true if pinned, false if not)
                        persistent = entity.components.networked.data.persistent;
                    } else {
                        // this only happens if this component is on a scene file, since the
                        // elements on the scene aren't networked.  So let's assume each entity in the
                        // scene will have a unique name.  Adding a bit of text so we can find it
                        // in the DOM when debugging.
                        netId = this.fullName.replaceAll("_","-") + "-html-script";
                    }

                    // check if the networked entity we create for this component already exists. 
                    // otherwise, create it
                    // - NOTE: it is created on the scene, not as a child of this entity, because
                    //   NAF creates remote entities in the scene.
                    var entity;
                    if (NAF.entities.hasEntity(netId)) {
                        entity = NAF.entities.getEntity(netId);
                    } else {
                        entity = document.createElement('a-entity');

                        // store the method to retrieve the script data on this entity
                        entity.getSharedData = this.getSharedData;

                        // the "networked" component should have persistent=true, the template and 
                        // networkId set, owner set to "scene" (so that it doesn't update the rest of
                        // the world with it's initial data, and should NOT set creator (the system will do that)
                        entity.setAttribute('networked', {
                            template: "#script-data-media",
                            persistent: persistent,
                            owner: "scene",  // so that our initial value doesn't overwrite others
                            networkId: netId
                        });
                        this.el.sceneEl.appendChild(entity);
                    }

                    // save a pointer to the networked entity and then wait for it to be fully
                    // initialized before getting a pointer to the actual networked component in it
                    this.netEntity = entity;
                    NAF.utils.getNetworkedEntity(this.netEntity).then(networkedEl => {
                        this.stateSync = networkedEl.components["script-data"];

                        // if this is the first networked entity, it's sharedData will default to the empty 
                        // string, and we should initialize it with the initial data from the script
                        if (this.stateSync.sharedData === 0) {
                            networkedEl.components["networked"];
                            // if (networked.data.creator == NAF.clientId) {
                            //     this.stateSync.initSharedData(this.script.getSharedData())
                            // }
                        }
                    });
                };
                this.setupNetworkedEntity = this.setupNetworkedEntity.bind(this);

                this.setupNetworked = function () {
                    NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
                        this.setupNetworkedEntity(networkedEl);
                    }).catch(() => {
                        this.setupNetworkedEntity();
                    });
                };
                this.setupNetworked = this.setupNetworked.bind(this);

                // This method handles the different startup cases:
                // - if the GLTF was dropped on the scene, NAF will be connected and we can 
                //   immediately initialize
                // - if the GLTF is in the room scene or pinned, it will likely be created
                //   before NAF is started and connected, so we wait for an event that is
                //   fired when Hubs has started NAF
                if (NAF.connection && NAF.connection.isConnected()) {
                    this.setupNetworked();
                } else {
                    this.el.sceneEl.addEventListener('didConnectToNetworkedScene', this.setupNetworked);
                }
            }
        });
    },

    play: function () {
        if (this.script) {
            this.script.play();
        }
    },

    pause: function () {
        if (this.script) {
            this.script.pause();
        }
    },

    // handle "interact" events for clickable entities
    clicked: function(evt) {
        this.script.clicked(evt); 
    },
  
    // methods that will be passed to the html object so they can update networked data
    takeOwnership: function() {
        if (this.stateSync) {
            return this.stateSync.takeOwnership()
        } else {
            return true;  // sure, go ahead and change it for now
        }
    },
    
    setSharedData: function(dataObject) {
        if (this.stateSync) {
            return this.stateSync.setSharedData(dataObject)
        }
        return true
    },

    // this is called from below, to get the initial data from the script
    getSharedData: function() {
        if (this.script) {
            return this.script.getSharedData()
        }
        // shouldn't happen
        console.warn("script-data component called parent element but there is no script yet?");
        return "{}"
    },

    // per frame stuff
    tick: function (time) {
        if (!this.script) return

        if (this.script.isInteractive) {
            // more or less copied from "hoverable-visuals.js" in hubs
            const toggling = this.el.sceneEl.systems["hubs-systems"].cursorTogglingSystem;
            var passthruInteractor = [];

            let interactorOne, interactorTwo;
            const interaction = this.el.sceneEl.systems.interaction;
            if (!interaction.ready) return; //DOMContentReady workaround
            
            let hoverEl = this.simpleContainer;
            if (interaction.state.leftHand.hovered === hoverEl && !interaction.state.leftHand.held) {
              interactorOne = interaction.options.leftHand.entity.object3D;
            }
            if (
              interaction.state.leftRemote.hovered === hoverEl &&
              !interaction.state.leftRemote.held &&
              !toggling.leftToggledOff
            ) {
              interactorOne = interaction.options.leftRemote.entity.object3D;
            }
            if (interactorOne) {
                let pos = interactorOne.position;
                let dir = this.script.webLayer3D.getWorldDirection(new THREE.Vector3()).negate();
                pos.addScaledVector(dir, -0.1);
                this.hoverRayL.set(pos, dir);

                passthruInteractor.push(this.hoverRayL);
            }
            if (
              interaction.state.rightRemote.hovered === hoverEl &&
              !interaction.state.rightRemote.held &&
              !toggling.rightToggledOff
            ) {
              interactorTwo = interaction.options.rightRemote.entity.object3D;
            }
            if (interaction.state.rightHand.hovered === hoverEl && !interaction.state.rightHand.held) {
                interactorTwo = interaction.options.rightHand.entity.object3D;
            }
            if (interactorTwo) {
                let pos = interactorTwo.position;
                let dir = this.script.webLayer3D.getWorldDirection(new THREE.Vector3()).negate();
                pos.addScaledVector(dir, -0.1);
                this.hoverRayR.set(pos, dir);
                passthruInteractor.push(this.hoverRayR);
            }

            this.script.webLayer3D.interactionRays = passthruInteractor;
        }

        if (this.script.isNetworked) {
            // if we haven't finished setting up the networked entity don't do anything.
            if (!this.netEntity || !this.stateSync) { return }

            // if the state has changed in the networked data, update our html object
            if (this.stateSync.changed) {
                this.stateSync.changed = false;
                this.script.updateSharedData(this.stateSync.dataObject);
            }
        }

        this.script.tick(time);
    },
  
  parseNodeName: function () {
        if (this.fullName === "") {
            this.fullName = this.el.parentEl.parentEl.className;
        }

        // nodes should be named anything at the beginning with 
        //  "componentName"
        // at the very end.  This will fetch the component from the resource
        // componentName
        const params = this.fullName.match(/_([A-Za-z0-9]*)$/);

        // if pattern matches, we will have length of 3, first match is the dir,
        // second is the componentName name or number
        if (!params || params.length < 2) {
            console.warn("html-script componentName not formatted correctly: ", this.fullName);
            this.componentName = null;
        } else {
            this.componentName = params[1];
        }
  },

  loadScript: async function () {
        // if (scriptPromise) {
        //     try {
        //         htmlComponents = await scriptPromise;
        //     } catch(e) {
        //         console.error(e);
        //         return
        //     }
        //     scriptPromise = null
        // }
        var initScript = htmlComponents[this.componentName];
        if (!initScript) {
            console.warn("'html-script' component doesn't have script for " + this.componentName);
            this.script = null;
            return;
        }
        this.script = initScript();
        if (this.script){
            this.script.needsUpdate = true;
            // this.script.webLayer3D.refresh(true)
            // this.script.webLayer3D.update(true)
        } else {
            console.warn("'html-script' component failed to initialize script for " + this.componentName);
        }
    },

    destroyScript: function () {
        if (this.script.isInteractive) {
            this.simpleContainer.object3D.removeEventListener('interact', this.clicked);
        }
        this.el.removeChild(this.simpleContainer);
        this.simpleContainer = null;

        this.script.destroy();
        this.script = null;
    }
});

//
// Component for our networked state.  This component does nothing except all us to 
// change the state when appropriate. We could set this up to signal the component above when
// something has changed, instead of having the component above poll each frame.
//

AFRAME.registerComponent('script-data', {
    schema: {
        scriptdata: {type: "string", default: "{}"},
    },
    init: function () {
        this.takeOwnership = this.takeOwnership.bind(this);
        this.setSharedData = this.setSharedData.bind(this);

        this.dataObject = this.el.getSharedData();
        try {
            this.sharedData = encodeURIComponent(JSON.stringify(this.dataObject));
            this.el.setAttribute("script-data", "scriptdata", this.sharedData);
        } catch(e) {
            console.error("Couldn't encode initial script data object: ", e, this.dataObject);
            this.sharedData = "{}";
            this.dataObject = {};
        }
        this.changed = false;
    },

    update() {
        this.changed = !(this.sharedData === this.data.scriptdata);
        if (this.changed) {
            try {
                this.dataObject = JSON.parse(decodeURIComponent(this.data.scriptdata));

                // do these after the JSON parse to make sure it has succeeded
                this.sharedData = this.data.scriptdata;
                this.changed = true;
            } catch(e) {
                console.error("couldn't parse JSON received in script-sync: ", e);
                this.sharedData = "";
                this.dataObject = {};
            }
        }
    },

    // it is likely that applyPersistentSync only needs to be called for persistent
    // networked entities, so we _probably_ don't need to do this.  But if there is no
    // persistent data saved from the network for this entity, this command does nothing.
    play() {
        if (this.el.components.networked) {
            // not sure if this is really needed, but can't hurt
            if (APP.utils) { // temporary till we ship new client
                APP.utils.applyPersistentSync(this.el.components.networked.data.networkId);
            }
        }
    },

    takeOwnership() {
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return false;

        return true;
    },

    // initSharedData(dataObject) {
    //     try {
    //         var htmlString = encodeURIComponent(JSON.stringify(dataObject))
    //         this.sharedData = htmlString
    //         this.dataObject = dataObject
    //         return true
    //     } catch (e) {
    //         console.error("can't stringify the object passed to script-sync")
    //         return false
    //     }
    // },

    // The key part in these methods (which are called from the component above) is to
    // check if we are allowed to change the networked object.  If we own it (isMine() is true)
    // we can change it.  If we don't own in, we can try to become the owner with
    // takeOwnership(). If this succeeds, we can set the data.  
    //
    // NOTE: takeOwnership ATTEMPTS to become the owner, by assuming it can become the
    // owner and notifying the networked copies.  If two or more entities try to become
    // owner,  only one (the last one to try) becomes the owner.  Any state updates done
    // by the "failed attempted owners" will not be distributed to the other clients,
    // and will be overwritten (eventually) by updates from the other clients.   By not
    // attempting to guarantee ownership, this call is fast and synchronous.  Any 
    // methods for guaranteeing ownership change would take a non-trivial amount of time
    // because of network latencies.

    setSharedData(dataObject) {
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return false;

        try {
            var htmlString = encodeURIComponent(JSON.stringify(dataObject));
            this.sharedData = htmlString;
            this.dataObject = dataObject;
            this.el.setAttribute("script-data", "scriptdata", htmlString);
            return true
        } catch (e) {
            console.error("can't stringify the object passed to script-sync");
            return false
        }
    }
});

// Add our template for our networked object to the a-frame assets object,
// and a schema to the NAF.schemas.  Both must be there to have custom components work

const assets = document.querySelector("a-assets");

assets.insertAdjacentHTML(
    'beforeend',
    `
    <template id="script-data-media">
      <a-entity
        script-data
      ></a-entity>
    </template>
  `
  );

NAF.schemas.add({
  	template: "#script-data-media",
    components: [
    // {
    //     component: "script-data",
    //     property: "rotation",
    //     requiresNetworkUpdate: vectorRequiresUpdate(0.001)
    // },
    // {
    //     component: "script-data",
    //     property: "scale",
    //     requiresNetworkUpdate: vectorRequiresUpdate(0.001)
    // },
    {
      	component: "script-data",
      	property: "scriptdata"
    }],
      nonAuthorizedComponents: [
      {
            component: "script-data",
            property: "scriptdata"
      }
    ],

  });

AFRAME.GLTFModelPlus.registerComponent('immersive-360', 'immersive-360');
AFRAME.GLTFModelPlus.registerComponent('portal', 'portal');
AFRAME.GLTFModelPlus.registerComponent('parallax', 'parallax');
AFRAME.GLTFModelPlus.registerComponent('html-script', 'html-script');
// do a simple monkey patch to see if it works
// var myisMineOrLocal = function (that) {
//     return !that.el.components.networked || (that.networkedEl && NAF.utils.isMine(that.networkedEl));
//  }
//  var videoComp = AFRAME.components["media-video"]
//  videoComp.Component.prototype.isMineOrLocal = myisMineOrLocal;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL3NyYy9zeXN0ZW1zL2ZhZGVyLXBsdXMuanMiLCIuLi9zcmMvY29tcG9uZW50cy9wcm94aW1pdHktZXZlbnRzLmpzIiwiLi4vc3JjL3NoYWRlcnMvcG9ydGFsLnZlcnQuanMiLCIuLi9zcmMvc2hhZGVycy9wb3J0YWwuZnJhZy5qcyIsIi4uL3NyYy9zaGFkZXJzL3Nub2lzZS5qcyIsIi4uL3NyYy91dGlscy9jb21wb25lbnQtdXRpbHMuanMiLCIuLi9zcmMvdXRpbHMvc2NlbmUtZ3JhcGguanMiLCIuLi9zcmMvY29tcG9uZW50cy9yZWdpb24taGlkZXIuanMiLCIuLi9zcmMvY29tcG9uZW50cy9wb3J0YWwuanMiLCIuLi9zcmMvY29tcG9uZW50cy9pbW1lcnNpdmUtMzYwLmpzIiwiLi4vc3JjL3NoYWRlcnMvcGFyYWxsYXgtc2hhZGVyLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvcGFyYWxsYXguanMiLCIuLi9zcmMvY29tcG9uZW50cy9odG1sLXNjcmlwdC5qcyIsIi4uL3NyYy9yb29tcy9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE1vZGlmaWVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvaHVicy9ibG9iL21hc3Rlci9zcmMvY29tcG9uZW50cy9mYWRlci5qc1xuICogdG8gaW5jbHVkZSBhZGp1c3RhYmxlIGR1cmF0aW9uIGFuZCBjb252ZXJ0ZWQgZnJvbSBjb21wb25lbnQgdG8gc3lzdGVtXG4gKi9cblxuQUZSQU1FLnJlZ2lzdGVyU3lzdGVtKCdmYWRlci1wbHVzJywge1xuICBzY2hlbWE6IHtcbiAgICBkaXJlY3Rpb246IHsgdHlwZTogJ3N0cmluZycsIGRlZmF1bHQ6ICdub25lJyB9LCAvLyBcImluXCIsIFwib3V0XCIsIG9yIFwibm9uZVwiXG4gICAgZHVyYXRpb246IHsgdHlwZTogJ251bWJlcicsIGRlZmF1bHQ6IDIwMCB9LCAvLyBUcmFuc2l0aW9uIGR1cmF0aW9uIGluIG1pbGxpc2Vjb25kc1xuICAgIGNvbG9yOiB7IHR5cGU6ICdjb2xvcicsIGRlZmF1bHQ6ICd3aGl0ZScgfSxcbiAgfSxcblxuICBpbml0KCkge1xuICAgIGNvbnN0IG1lc2ggPSBuZXcgVEhSRUUuTWVzaChcbiAgICAgIG5ldyBUSFJFRS5Cb3hHZW9tZXRyeSgpLFxuICAgICAgbmV3IFRIUkVFLk1lc2hCYXNpY01hdGVyaWFsKHtcbiAgICAgICAgY29sb3I6IHRoaXMuZGF0YS5jb2xvcixcbiAgICAgICAgc2lkZTogVEhSRUUuQmFja1NpZGUsXG4gICAgICAgIG9wYWNpdHk6IDAsXG4gICAgICAgIHRyYW5zcGFyZW50OiB0cnVlLFxuICAgICAgICBmb2c6IGZhbHNlLFxuICAgICAgfSlcbiAgICApXG4gICAgbWVzaC5zY2FsZS54ID0gbWVzaC5zY2FsZS55ID0gMVxuICAgIG1lc2guc2NhbGUueiA9IDAuMTVcbiAgICBtZXNoLm1hdHJpeE5lZWRzVXBkYXRlID0gdHJ1ZVxuICAgIG1lc2gucmVuZGVyT3JkZXIgPSAxIC8vIHJlbmRlciBhZnRlciBvdGhlciB0cmFuc3BhcmVudCBzdHVmZlxuICAgIHRoaXMuZWwuY2FtZXJhLmFkZChtZXNoKVxuICAgIHRoaXMubWVzaCA9IG1lc2hcbiAgfSxcblxuICBmYWRlT3V0KCkge1xuICAgIHJldHVybiB0aGlzLmJlZ2luVHJhbnNpdGlvbignb3V0JylcbiAgfSxcblxuICBmYWRlSW4oKSB7XG4gICAgcmV0dXJuIHRoaXMuYmVnaW5UcmFuc2l0aW9uKCdpbicpXG4gIH0sXG5cbiAgYXN5bmMgYmVnaW5UcmFuc2l0aW9uKGRpcmVjdGlvbikge1xuICAgIGlmICh0aGlzLl9yZXNvbHZlRmluaXNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBmYWRlIHdoaWxlIGEgZmFkZSBpcyBoYXBwZW5pbmcuJylcbiAgICB9XG5cbiAgICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnZmFkZXItcGx1cycsIHsgZGlyZWN0aW9uIH0pXG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcykgPT4ge1xuICAgICAgaWYgKHRoaXMubWVzaC5tYXRlcmlhbC5vcGFjaXR5ID09PSAoZGlyZWN0aW9uID09ICdpbicgPyAwIDogMSkpIHtcbiAgICAgICAgcmVzKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX3Jlc29sdmVGaW5pc2ggPSByZXNcbiAgICAgIH1cbiAgICB9KVxuICB9LFxuXG4gIHRpY2sodCwgZHQpIHtcbiAgICBjb25zdCBtYXQgPSB0aGlzLm1lc2gubWF0ZXJpYWxcbiAgICB0aGlzLm1lc2gudmlzaWJsZSA9IHRoaXMuZGF0YS5kaXJlY3Rpb24gPT09ICdvdXQnIHx8IG1hdC5vcGFjaXR5ICE9PSAwXG4gICAgaWYgKCF0aGlzLm1lc2gudmlzaWJsZSkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5kYXRhLmRpcmVjdGlvbiA9PT0gJ2luJykge1xuICAgICAgbWF0Lm9wYWNpdHkgPSBNYXRoLm1heCgwLCBtYXQub3BhY2l0eSAtICgxLjAgLyB0aGlzLmRhdGEuZHVyYXRpb24pICogTWF0aC5taW4oZHQsIDUwKSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5kaXJlY3Rpb24gPT09ICdvdXQnKSB7XG4gICAgICBtYXQub3BhY2l0eSA9IE1hdGgubWluKDEsIG1hdC5vcGFjaXR5ICsgKDEuMCAvIHRoaXMuZGF0YS5kdXJhdGlvbikgKiBNYXRoLm1pbihkdCwgNTApKVxuICAgIH1cblxuICAgIGlmIChtYXQub3BhY2l0eSA9PT0gMCB8fCBtYXQub3BhY2l0eSA9PT0gMSkge1xuICAgICAgaWYgKHRoaXMuZGF0YS5kaXJlY3Rpb24gIT09ICdub25lJykge1xuICAgICAgICBpZiAodGhpcy5fcmVzb2x2ZUZpbmlzaCkge1xuICAgICAgICAgIHRoaXMuX3Jlc29sdmVGaW5pc2goKVxuICAgICAgICAgIHRoaXMuX3Jlc29sdmVGaW5pc2ggPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2ZhZGVyLXBsdXMnLCB7IGRpcmVjdGlvbjogJ25vbmUnIH0pXG4gICAgfVxuICB9LFxufSlcbiIsImNvbnN0IHdvcmxkQ2FtZXJhID0gbmV3IFRIUkVFLlZlY3RvcjMoKVxuY29uc3Qgd29ybGRTZWxmID0gbmV3IFRIUkVFLlZlY3RvcjMoKVxuXG5BRlJBTUUucmVnaXN0ZXJDb21wb25lbnQoJ3Byb3hpbWl0eS1ldmVudHMnLCB7XG4gIHNjaGVtYToge1xuICAgIHJhZGl1czogeyB0eXBlOiAnbnVtYmVyJywgZGVmYXVsdDogMSB9LFxuICB9LFxuICBpbml0KCkge1xuICAgIHRoaXMuaW5ab25lID0gZmFsc2VcbiAgICB0aGlzLmNhbWVyYSA9IHRoaXMuZWwuc2NlbmVFbC5jYW1lcmFcbiAgfSxcbiAgdGljaygpIHtcbiAgICB0aGlzLmNhbWVyYS5nZXRXb3JsZFBvc2l0aW9uKHdvcmxkQ2FtZXJhKVxuICAgIHRoaXMuZWwub2JqZWN0M0QuZ2V0V29ybGRQb3NpdGlvbih3b3JsZFNlbGYpXG4gICAgY29uc3Qgd2FzSW56b25lID0gdGhpcy5pblpvbmVcbiAgICB0aGlzLmluWm9uZSA9IHdvcmxkQ2FtZXJhLmRpc3RhbmNlVG8od29ybGRTZWxmKSA8IHRoaXMuZGF0YS5yYWRpdXNcbiAgICBpZiAodGhpcy5pblpvbmUgJiYgIXdhc0luem9uZSkgdGhpcy5lbC5lbWl0KCdwcm94aW1pdHllbnRlcicpXG4gICAgaWYgKCF0aGlzLmluWm9uZSAmJiB3YXNJbnpvbmUpIHRoaXMuZWwuZW1pdCgncHJveGltaXR5bGVhdmUnKVxuICB9LFxufSlcbiIsImNvbnN0IGdsc2wgPSBgXG52YXJ5aW5nIHZlYzIgdlV2O1xudmFyeWluZyB2ZWMzIHZSYXk7XG52YXJ5aW5nIHZlYzMgdk5vcm1hbDtcblxudm9pZCBtYWluKCkge1xuICB2VXYgPSB1djtcbiAgLy8gdk5vcm1hbCA9IG5vcm1hbE1hdHJpeCAqIG5vcm1hbDtcbiAgdmVjMyBjYW1lcmFMb2NhbCA9IChpbnZlcnNlKG1vZGVsTWF0cml4KSAqIHZlYzQoY2FtZXJhUG9zaXRpb24sIDEuMCkpLnh5ejtcbiAgdlJheSA9IHBvc2l0aW9uIC0gY2FtZXJhTG9jYWw7XG4gIHZOb3JtYWwgPSBub3JtYWxpemUoLTEuICogdlJheSk7XG4gIGZsb2F0IGRpc3QgPSBsZW5ndGgoY2FtZXJhTG9jYWwpO1xuICB2UmF5LnogKj0gMS4zIC8gKDEuICsgcG93KGRpc3QsIDAuNSkpOyAvLyBDaGFuZ2UgRk9WIGJ5IHNxdWFzaGluZyBsb2NhbCBaIGRpcmVjdGlvblxuICBnbF9Qb3NpdGlvbiA9IHByb2plY3Rpb25NYXRyaXggKiBtb2RlbFZpZXdNYXRyaXggKiB2ZWM0KHBvc2l0aW9uLCAxLjApO1xufVxuYFxuZXhwb3J0IGRlZmF1bHQgZ2xzbFxuIiwiY29uc3QgZ2xzbCA9IGBcbnVuaWZvcm0gc2FtcGxlckN1YmUgY3ViZU1hcDtcbnVuaWZvcm0gZmxvYXQgdGltZTtcbnVuaWZvcm0gZmxvYXQgcmFkaXVzO1xudW5pZm9ybSB2ZWMzIHJpbmdDb2xvcjtcblxudmFyeWluZyB2ZWMyIHZVdjtcbnZhcnlpbmcgdmVjMyB2UmF5O1xudmFyeWluZyB2ZWMzIHZOb3JtYWw7XG5cbiNkZWZpbmUgUklOR19XSURUSCAwLjFcbiNkZWZpbmUgUklOR19IQVJEX09VVEVSIDAuMDFcbiNkZWZpbmUgUklOR19IQVJEX0lOTkVSIDAuMDhcbiNkZWZpbmUgZm9yd2FyZCB2ZWMzKDAuMCwgMC4wLCAxLjApXG5cbnZvaWQgbWFpbigpIHtcbiAgdmVjMiBjb29yZCA9IHZVdiAqIDIuMCAtIDEuMDtcbiAgZmxvYXQgbm9pc2UgPSBzbm9pc2UodmVjMyhjb29yZCAqIDEuLCB0aW1lKSkgKiAwLjUgKyAwLjU7XG5cbiAgLy8gUG9sYXIgZGlzdGFuY2VcbiAgZmxvYXQgZGlzdCA9IGxlbmd0aChjb29yZCk7XG4gIGRpc3QgKz0gbm9pc2UgKiAwLjI7XG5cbiAgZmxvYXQgbWFza091dGVyID0gMS4wIC0gc21vb3Roc3RlcChyYWRpdXMgLSBSSU5HX0hBUkRfT1VURVIsIHJhZGl1cywgZGlzdCk7XG4gIGZsb2F0IG1hc2tJbm5lciA9IDEuMCAtIHNtb290aHN0ZXAocmFkaXVzIC0gUklOR19XSURUSCwgcmFkaXVzIC0gUklOR19XSURUSCArIFJJTkdfSEFSRF9JTk5FUiwgZGlzdCk7XG4gIGZsb2F0IGRpc3RvcnRpb24gPSBzbW9vdGhzdGVwKHJhZGl1cyAtIDAuMiwgcmFkaXVzICsgMC4yLCBkaXN0KTtcbiAgdmVjMyBub3JtYWwgPSBub3JtYWxpemUodk5vcm1hbCk7XG4gIGZsb2F0IGRpcmVjdFZpZXcgPSBzbW9vdGhzdGVwKDAuLCAwLjgsIGRvdChub3JtYWwsIGZvcndhcmQpKTtcbiAgdmVjMyB0YW5nZW50T3V0d2FyZCA9IHZlYzMoY29vcmQsIDAuMCk7XG4gIHZlYzMgcmF5ID0gbWl4KHZSYXksIHRhbmdlbnRPdXR3YXJkLCBkaXN0b3J0aW9uKTtcbiAgdmVjNCB0ZXhlbCA9IHRleHR1cmVDdWJlKGN1YmVNYXAsIHJheSk7XG4gIHZlYzMgY2VudGVyTGF5ZXIgPSB0ZXhlbC5yZ2IgKiBtYXNrSW5uZXI7XG4gIHZlYzMgcmluZ0xheWVyID0gcmluZ0NvbG9yICogKDEuIC0gbWFza0lubmVyKTtcbiAgdmVjMyBjb21wb3NpdGUgPSBjZW50ZXJMYXllciArIHJpbmdMYXllcjtcblxuICBnbF9GcmFnQ29sb3IgPSB2ZWM0KGNvbXBvc2l0ZSwgKG1hc2tPdXRlciAtIG1hc2tJbm5lcikgKyBtYXNrSW5uZXIgKiBkaXJlY3RWaWV3KTtcbn1cbmBcbmV4cG9ydCBkZWZhdWx0IGdsc2xcbiIsIi8qXG4gKiAzRCBTaW1wbGV4IG5vaXNlXG4gKiBTSUdOQVRVUkU6IGZsb2F0IHNub2lzZSh2ZWMzIHYpXG4gKiBodHRwczovL2dpdGh1Yi5jb20vaHVnaHNrL2dsc2wtbm9pc2VcbiAqL1xuXG5jb25zdCBnbHNsID0gYFxuLy9cbi8vIERlc2NyaXB0aW9uIDogQXJyYXkgYW5kIHRleHR1cmVsZXNzIEdMU0wgMkQvM0QvNEQgc2ltcGxleFxuLy8gICAgICAgICAgICAgICBub2lzZSBmdW5jdGlvbnMuXG4vLyAgICAgIEF1dGhvciA6IElhbiBNY0V3YW4sIEFzaGltYSBBcnRzLlxuLy8gIE1haW50YWluZXIgOiBpam1cbi8vICAgICBMYXN0bW9kIDogMjAxMTA4MjIgKGlqbSlcbi8vICAgICBMaWNlbnNlIDogQ29weXJpZ2h0IChDKSAyMDExIEFzaGltYSBBcnRzLiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuLy8gICAgICAgICAgICAgICBEaXN0cmlidXRlZCB1bmRlciB0aGUgTUlUIExpY2Vuc2UuIFNlZSBMSUNFTlNFIGZpbGUuXG4vLyAgICAgICAgICAgICAgIGh0dHBzOi8vZ2l0aHViLmNvbS9hc2hpbWEvd2ViZ2wtbm9pc2Vcbi8vXG5cbnZlYzMgbW9kMjg5KHZlYzMgeCkge1xuICByZXR1cm4geCAtIGZsb29yKHggKiAoMS4wIC8gMjg5LjApKSAqIDI4OS4wO1xufVxuXG52ZWM0IG1vZDI4OSh2ZWM0IHgpIHtcbiAgcmV0dXJuIHggLSBmbG9vcih4ICogKDEuMCAvIDI4OS4wKSkgKiAyODkuMDtcbn1cblxudmVjNCBwZXJtdXRlKHZlYzQgeCkge1xuICAgICByZXR1cm4gbW9kMjg5KCgoeCozNC4wKSsxLjApKngpO1xufVxuXG52ZWM0IHRheWxvckludlNxcnQodmVjNCByKVxue1xuICByZXR1cm4gMS43OTI4NDI5MTQwMDE1OSAtIDAuODUzNzM0NzIwOTUzMTQgKiByO1xufVxuXG5mbG9hdCBzbm9pc2UodmVjMyB2KVxuICB7XG4gIGNvbnN0IHZlYzIgIEMgPSB2ZWMyKDEuMC82LjAsIDEuMC8zLjApIDtcbiAgY29uc3QgdmVjNCAgRCA9IHZlYzQoMC4wLCAwLjUsIDEuMCwgMi4wKTtcblxuLy8gRmlyc3QgY29ybmVyXG4gIHZlYzMgaSAgPSBmbG9vcih2ICsgZG90KHYsIEMueXl5KSApO1xuICB2ZWMzIHgwID0gICB2IC0gaSArIGRvdChpLCBDLnh4eCkgO1xuXG4vLyBPdGhlciBjb3JuZXJzXG4gIHZlYzMgZyA9IHN0ZXAoeDAueXp4LCB4MC54eXopO1xuICB2ZWMzIGwgPSAxLjAgLSBnO1xuICB2ZWMzIGkxID0gbWluKCBnLnh5eiwgbC56eHkgKTtcbiAgdmVjMyBpMiA9IG1heCggZy54eXosIGwuenh5ICk7XG5cbiAgLy8gICB4MCA9IHgwIC0gMC4wICsgMC4wICogQy54eHg7XG4gIC8vICAgeDEgPSB4MCAtIGkxICArIDEuMCAqIEMueHh4O1xuICAvLyAgIHgyID0geDAgLSBpMiAgKyAyLjAgKiBDLnh4eDtcbiAgLy8gICB4MyA9IHgwIC0gMS4wICsgMy4wICogQy54eHg7XG4gIHZlYzMgeDEgPSB4MCAtIGkxICsgQy54eHg7XG4gIHZlYzMgeDIgPSB4MCAtIGkyICsgQy55eXk7IC8vIDIuMCpDLnggPSAxLzMgPSBDLnlcbiAgdmVjMyB4MyA9IHgwIC0gRC55eXk7ICAgICAgLy8gLTEuMCszLjAqQy54ID0gLTAuNSA9IC1ELnlcblxuLy8gUGVybXV0YXRpb25zXG4gIGkgPSBtb2QyODkoaSk7XG4gIHZlYzQgcCA9IHBlcm11dGUoIHBlcm11dGUoIHBlcm11dGUoXG4gICAgICAgICAgICAgaS56ICsgdmVjNCgwLjAsIGkxLnosIGkyLnosIDEuMCApKVxuICAgICAgICAgICArIGkueSArIHZlYzQoMC4wLCBpMS55LCBpMi55LCAxLjAgKSlcbiAgICAgICAgICAgKyBpLnggKyB2ZWM0KDAuMCwgaTEueCwgaTIueCwgMS4wICkpO1xuXG4vLyBHcmFkaWVudHM6IDd4NyBwb2ludHMgb3ZlciBhIHNxdWFyZSwgbWFwcGVkIG9udG8gYW4gb2N0YWhlZHJvbi5cbi8vIFRoZSByaW5nIHNpemUgMTcqMTcgPSAyODkgaXMgY2xvc2UgdG8gYSBtdWx0aXBsZSBvZiA0OSAoNDkqNiA9IDI5NClcbiAgZmxvYXQgbl8gPSAwLjE0Mjg1NzE0Mjg1NzsgLy8gMS4wLzcuMFxuICB2ZWMzICBucyA9IG5fICogRC53eXogLSBELnh6eDtcblxuICB2ZWM0IGogPSBwIC0gNDkuMCAqIGZsb29yKHAgKiBucy56ICogbnMueik7ICAvLyAgbW9kKHAsNyo3KVxuXG4gIHZlYzQgeF8gPSBmbG9vcihqICogbnMueik7XG4gIHZlYzQgeV8gPSBmbG9vcihqIC0gNy4wICogeF8gKTsgICAgLy8gbW9kKGosTilcblxuICB2ZWM0IHggPSB4XyAqbnMueCArIG5zLnl5eXk7XG4gIHZlYzQgeSA9IHlfICpucy54ICsgbnMueXl5eTtcbiAgdmVjNCBoID0gMS4wIC0gYWJzKHgpIC0gYWJzKHkpO1xuXG4gIHZlYzQgYjAgPSB2ZWM0KCB4Lnh5LCB5Lnh5ICk7XG4gIHZlYzQgYjEgPSB2ZWM0KCB4Lnp3LCB5Lnp3ICk7XG5cbiAgLy92ZWM0IHMwID0gdmVjNChsZXNzVGhhbihiMCwwLjApKSoyLjAgLSAxLjA7XG4gIC8vdmVjNCBzMSA9IHZlYzQobGVzc1RoYW4oYjEsMC4wKSkqMi4wIC0gMS4wO1xuICB2ZWM0IHMwID0gZmxvb3IoYjApKjIuMCArIDEuMDtcbiAgdmVjNCBzMSA9IGZsb29yKGIxKSoyLjAgKyAxLjA7XG4gIHZlYzQgc2ggPSAtc3RlcChoLCB2ZWM0KDAuMCkpO1xuXG4gIHZlYzQgYTAgPSBiMC54enl3ICsgczAueHp5dypzaC54eHl5IDtcbiAgdmVjNCBhMSA9IGIxLnh6eXcgKyBzMS54enl3KnNoLnp6d3cgO1xuXG4gIHZlYzMgcDAgPSB2ZWMzKGEwLnh5LGgueCk7XG4gIHZlYzMgcDEgPSB2ZWMzKGEwLnp3LGgueSk7XG4gIHZlYzMgcDIgPSB2ZWMzKGExLnh5LGgueik7XG4gIHZlYzMgcDMgPSB2ZWMzKGExLnp3LGgudyk7XG5cbi8vTm9ybWFsaXNlIGdyYWRpZW50c1xuICB2ZWM0IG5vcm0gPSB0YXlsb3JJbnZTcXJ0KHZlYzQoZG90KHAwLHAwKSwgZG90KHAxLHAxKSwgZG90KHAyLCBwMiksIGRvdChwMyxwMykpKTtcbiAgcDAgKj0gbm9ybS54O1xuICBwMSAqPSBub3JtLnk7XG4gIHAyICo9IG5vcm0uejtcbiAgcDMgKj0gbm9ybS53O1xuXG4vLyBNaXggZmluYWwgbm9pc2UgdmFsdWVcbiAgdmVjNCBtID0gbWF4KDAuNiAtIHZlYzQoZG90KHgwLHgwKSwgZG90KHgxLHgxKSwgZG90KHgyLHgyKSwgZG90KHgzLHgzKSksIDAuMCk7XG4gIG0gPSBtICogbTtcbiAgcmV0dXJuIDQyLjAgKiBkb3QoIG0qbSwgdmVjNCggZG90KHAwLHgwKSwgZG90KHAxLHgxKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZG90KHAyLHgyKSwgZG90KHAzLHgzKSApICk7XG4gIH0gIFxuYFxuZXhwb3J0IGRlZmF1bHQgZ2xzbFxuIiwiLy8gUHJvdmlkZXMgYSBnbG9iYWwgcmVnaXN0cnkgb2YgcnVubmluZyBjb21wb25lbnRzXG4vLyBjb3BpZWQgZnJvbSBodWJzIHNvdXJjZVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJDb21wb25lbnRJbnN0YW5jZShjb21wb25lbnQsIG5hbWUpIHtcbiAgICB3aW5kb3cuQVBQLmNvbXBvbmVudFJlZ2lzdHJ5ID0gd2luZG93LkFQUC5jb21wb25lbnRSZWdpc3RyeSB8fCB7fTtcbiAgICB3aW5kb3cuQVBQLmNvbXBvbmVudFJlZ2lzdHJ5W25hbWVdID0gd2luZG93LkFQUC5jb21wb25lbnRSZWdpc3RyeVtuYW1lXSB8fCBbXTtcbiAgICB3aW5kb3cuQVBQLmNvbXBvbmVudFJlZ2lzdHJ5W25hbWVdLnB1c2goY29tcG9uZW50KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcmVnaXN0ZXJDb21wb25lbnRJbnN0YW5jZShjb21wb25lbnQsIG5hbWUpIHtcbiAgICBpZiAoIXdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnkgfHwgIXdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnlbbmFtZV0pIHJldHVybjtcbiAgICB3aW5kb3cuQVBQLmNvbXBvbmVudFJlZ2lzdHJ5W25hbWVdLnNwbGljZSh3aW5kb3cuQVBQLmNvbXBvbmVudFJlZ2lzdHJ5W25hbWVdLmluZGV4T2YoY29tcG9uZW50KSwgMSk7XG59XG4gICIsIi8vIGNvcGllZCBmcm9tIGh1YnNcblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRBbmNlc3RvcldpdGhDb21wb25lbnQoZW50aXR5LCBjb21wb25lbnROYW1lKSB7XG4gICAgd2hpbGUgKGVudGl0eSAmJiAhKGVudGl0eS5jb21wb25lbnRzICYmIGVudGl0eS5jb21wb25lbnRzW2NvbXBvbmVudE5hbWVdKSkge1xuICAgICAgZW50aXR5ID0gZW50aXR5LnBhcmVudE5vZGU7XG4gICAgfVxuICAgIHJldHVybiBlbnRpdHk7XG4gIH1cbiAgXG4gIGV4cG9ydCBmdW5jdGlvbiBmaW5kQ29tcG9uZW50c0luTmVhcmVzdEFuY2VzdG9yKGVudGl0eSwgY29tcG9uZW50TmFtZSkge1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBbXTtcbiAgICB3aGlsZSAoZW50aXR5KSB7XG4gICAgICBpZiAoZW50aXR5LmNvbXBvbmVudHMpIHtcbiAgICAgICAgZm9yIChjb25zdCBjIGluIGVudGl0eS5jb21wb25lbnRzKSB7XG4gICAgICAgICAgaWYgKGVudGl0eS5jb21wb25lbnRzW2NdLm5hbWUgPT09IGNvbXBvbmVudE5hbWUpIHtcbiAgICAgICAgICAgIGNvbXBvbmVudHMucHVzaChlbnRpdHkuY29tcG9uZW50c1tjXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoY29tcG9uZW50cy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gICAgICB9XG4gICAgICBlbnRpdHkgPSBlbnRpdHkucGFyZW50Tm9kZTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBvbmVudHM7XG4gIH1cbiAgIiwiLyoqXG4gKiBEZXNjcmlwdGlvblxuICogPT09PT09PT09PT1cbiAqIGJyZWFrIHRoZSByb29tIGludG8gcXVhZHJhbnRzIG9mIGEgY2VydGFpbiBzaXplLCBhbmQgaGlkZSB0aGUgY29udGVudHMgb2YgYXJlYXMgdGhhdCBoYXZlXG4gKiBub2JvZHkgaW4gdGhlbS4gIE1lZGlhIHdpbGwgYmUgcGF1c2VkIGluIHRob3NlIGFyZWFzIHRvby5cbiAqIFxuICogSW5jbHVkZSBhIHdheSBmb3IgdGhlIHBvcnRhbCBjb21wb25lbnQgdG8gdHVybiBvbiBlbGVtZW50cyBpbiB0aGUgcmVnaW9uIG9mIHRoZSBwb3J0YWwgYmVmb3JlXG4gKiBpdCBjYXB0dXJlcyBhIGN1YmVtYXBcbiAqL1xuXG5pbXBvcnQgeyByZWdpc3RlckNvbXBvbmVudEluc3RhbmNlLCBkZXJlZ2lzdGVyQ29tcG9uZW50SW5zdGFuY2UgfSBmcm9tIFwiLi4vdXRpbHMvY29tcG9uZW50LXV0aWxzXCI7XG5pbXBvcnQgeyBmaW5kQW5jZXN0b3JXaXRoQ29tcG9uZW50IH0gZnJvbSBcIi4uL3V0aWxzL3NjZW5lLWdyYXBoXCI7XG5cbiAvLyBhcmJpdHJhcmlseSBjaG9vc2UgMTAwMDAwMCBhcyB0aGUgbnVtYmVyIG9mIGNvbXB1dGVkIHpvbmVzIGluICB4IGFuZCB5XG5sZXQgTUFYX1pPTkVTID0gMTAwMDAwMFxubGV0IHJlZ2lvblRhZyA9IGZ1bmN0aW9uKHNpemUsIG9iajNkKSB7XG4gICAgbGV0IHBvcyA9IG9iajNkLnBvc2l0aW9uXG4gICAgbGV0IHhwID0gTWF0aC5mbG9vcihwb3MueCAvIHNpemUpICsgTUFYX1pPTkVTLzJcbiAgICBsZXQgenAgPSBNYXRoLmZsb29yKHBvcy56IC8gc2l6ZSkgKyBNQVhfWk9ORVMvMlxuICAgIHJldHVybiBNQVhfWk9ORVMgKiB4cCArIHpwXG59XG5cbmxldCByZWdpb25zSW5Vc2UgPSBbXVxuXG4vKipcbiAqIEZpbmQgdGhlIGNsb3Nlc3QgYW5jZXN0b3IgKGluY2x1ZGluZyB0aGUgcGFzc2VkIGluIGVudGl0eSkgdGhhdCBoYXMgYW4gYG9iamVjdC1yZWdpb24tZm9sbG93ZXJgIGNvbXBvbmVudCxcbiAqIGFuZCByZXR1cm4gdGhhdCBjb21wb25lbnRcbiAqL1xuZnVuY3Rpb24gZ2V0UmVnaW9uRm9sbG93ZXIoZW50aXR5KSB7XG4gICAgbGV0IGN1ckVudGl0eSA9IGVudGl0eTtcbiAgXG4gICAgd2hpbGUoY3VyRW50aXR5ICYmIGN1ckVudGl0eS5jb21wb25lbnRzICYmICFjdXJFbnRpdHkuY29tcG9uZW50c1tcIm9iamVjdC1yZWdpb24tZm9sbG93ZXJcIl0pIHtcbiAgICAgICAgY3VyRW50aXR5ID0gY3VyRW50aXR5LnBhcmVudE5vZGU7XG4gICAgfVxuICBcbiAgICBpZiAoIWN1ckVudGl0eSB8fCAhY3VyRW50aXR5LmNvbXBvbmVudHMgfHwgIWN1ckVudGl0eS5jb21wb25lbnRzW1wib2JqZWN0LXJlZ2lvbi1mb2xsb3dlclwiXSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBjdXJFbnRpdHkuY29tcG9uZW50c1tcIm9iamVjdC1yZWdpb24tZm9sbG93ZXJcIl1cbn1cbiAgXG5mdW5jdGlvbiBhZGRUb1JlZ2lvbihyZWdpb24pIHtcbiAgICByZWdpb25zSW5Vc2VbcmVnaW9uXSA/IHJlZ2lvbnNJblVzZVtyZWdpb25dKysgOiByZWdpb25zSW5Vc2VbcmVnaW9uXSA9IDFcbiAgICBjb25zb2xlLmxvZyhcIkF2YXRhcnMgaW4gcmVnaW9uIFwiICsgcmVnaW9uICsgXCI6IFwiICsgcmVnaW9uc0luVXNlW3JlZ2lvbl0pXG4gICAgaWYgKHJlZ2lvbnNJblVzZVtyZWdpb25dID09IDEpIHtcbiAgICAgICAgc2hvd0hpZGVPYmplY3RzSW5SZWdpb24ocmVnaW9uLCB0cnVlKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiYWxyZWFkeSBhbm90aGVyIGF2YXRhciBpbiB0aGlzIHJlZ2lvbiwgbm8gY2hhbmdlXCIpXG4gICAgfVxufVxuXG5mdW5jdGlvbiBzdWJ0cmFjdEZyb21SZWdpb24ocmVnaW9uKSB7XG4gICAgaWYgKHJlZ2lvbnNJblVzZVtyZWdpb25dKSB7cmVnaW9uc0luVXNlW3JlZ2lvbl0tLSB9XG4gICAgY29uc29sZS5sb2coXCJBdmF0YXJzIGxlZnQgcmVnaW9uIFwiICsgcmVnaW9uICsgXCI6IFwiICsgcmVnaW9uc0luVXNlW3JlZ2lvbl0pXG5cbiAgICBpZiAocmVnaW9uc0luVXNlW3JlZ2lvbl0gPT0gMCkge1xuICAgICAgICBzaG93SGlkZU9iamVjdHNJblJlZ2lvbihyZWdpb24sIGZhbHNlKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwic3RpbGwgYW5vdGhlciBhdmF0YXIgaW4gdGhpcyByZWdpb24sIG5vIGNoYW5nZVwiKVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3dSZWdpb25Gb3JPYmplY3QoZWxlbWVudCkge1xuICAgIGxldCBmb2xsb3dlciA9IGdldFJlZ2lvbkZvbGxvd2VyKGVsZW1lbnQpXG4gICAgaWYgKCFmb2xsb3dlcikgeyByZXR1cm4gfVxuXG4gICAgY29uc29sZS5sb2coXCJzaG93aW5nIG9iamVjdHMgbmVhciBcIiArIGZvbGxvd2VyLmVsLmNsYXNzTmFtZSlcblxuICAgIGFkZFRvUmVnaW9uKGZvbGxvd2VyLnJlZ2lvbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhpZGVyUmVnaW9uRm9yT2JqZWN0KGVsZW1lbnQpIHtcbiAgICBsZXQgZm9sbG93ZXIgPSBnZXRSZWdpb25Gb2xsb3dlcihlbGVtZW50KVxuICAgIGlmICghZm9sbG93ZXIpIHsgcmV0dXJuIH1cblxuICAgIGNvbnNvbGUubG9nKFwiaGlkaW5nIG9iamVjdHMgbmVhciBcIiArIGZvbGxvd2VyLmVsLmNsYXNzTmFtZSlcblxuICAgIHN1YnRyYWN0RnJvbVJlZ2lvbihmb2xsb3dlci5yZWdpb24pXG59XG5cbmZ1bmN0aW9uIHNob3dIaWRlT2JqZWN0cygpIHtcbiAgICBpZiAoIXdpbmRvdy5BUFAgfHwgIXdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnkpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNvbnNvbGUubG9nIChcInNob3dpbmcvaGlkaW5nIGFsbCBvYmplY3RzXCIpXG4gICAgY29uc3Qgb2JqZWN0cyA9IHdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnlbXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCJdIHx8IFtdO1xuICBcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9iamVjdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9iaiA9IG9iamVjdHNbaV07XG4gICAgICBcbiAgICAgIGxldCB2aXNpYmxlID0gcmVnaW9uc0luVXNlW29iai5yZWdpb25dID8gdHJ1ZTogZmFsc2VcbiAgICAgICAgXG4gICAgICBpZiAob2JqLmVsLm9iamVjdDNELnZpc2libGUgPT0gdmlzaWJsZSkgeyBjb250aW51ZSB9XG5cbiAgICAgIGNvbnNvbGUubG9nICgodmlzaWJsZSA/IFwic2hvd2luZyBcIiA6IFwiaGlkaW5nIFwiKSArIG9iai5lbC5jbGFzc05hbWUpXG4gICAgICBvYmouc2hvd0hpZGUodmlzaWJsZSlcbiAgICB9XG4gIFxuICAgIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBzaG93SGlkZU9iamVjdHNJblJlZ2lvbihyZWdpb24sIHZpc2libGUpIHtcbiAgICBpZiAoIXdpbmRvdy5BUFAgfHwgIXdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnkpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNvbnNvbGUubG9nICgodmlzaWJsZSA/IFwic2hvd2luZ1wiIDogXCJoaWRpbmdcIikgKyBcIiBhbGwgb2JqZWN0cyBpbiByZWdpb24gXCIgKyByZWdpb24pXG4gICAgY29uc3Qgb2JqZWN0cyA9IHdpbmRvdy5BUFAuY29tcG9uZW50UmVnaXN0cnlbXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCJdIHx8IFtdO1xuICBcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9iamVjdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG9iaiA9IG9iamVjdHNbaV07XG4gICAgICBcbiAgICAgIGlmIChvYmoucmVnaW9uID09IHJlZ2lvbikge1xuICAgICAgICBjb25zb2xlLmxvZyAoKHZpc2libGUgPyBcInNob3dpbmcgXCIgOiBcIiBoaWRpbmdcIikgKyBvYmouZWwuY2xhc3NOYW1lKVxuICAgICAgICBvYmouc2hvd0hpZGUodmlzaWJsZSlcbiAgICAgIH1cbiAgICB9XG4gIFxuICAgIHJldHVybiBudWxsO1xufVxuICBcbkFGUkFNRS5yZWdpc3RlckNvbXBvbmVudCgnYXZhdGFyLXJlZ2lvbi1mb2xsb3dlcicsIHtcbiAgICBzY2hlbWE6IHtcbiAgICAgICAgc2l6ZTogeyBkZWZhdWx0OiAxMCB9XG4gICAgfSxcbiAgICBpbml0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucmVnaW9uID0gcmVnaW9uVGFnKHRoaXMuZGF0YS5zaXplLCB0aGlzLmVsLm9iamVjdDNEKVxuICAgICAgICBjb25zb2xlLmxvZyhcIkF2YXRhcjogcmVnaW9uIFwiLCB0aGlzLnJlZ2lvbilcbiAgICAgICAgYWRkVG9SZWdpb24odGhpcy5yZWdpb24pXG5cbiAgICAgICAgcmVnaXN0ZXJDb21wb25lbnRJbnN0YW5jZSh0aGlzLCBcImF2YXRhci1yZWdpb24tZm9sbG93ZXJcIik7XG4gICAgfSxcbiAgICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgICAgICBkZXJlZ2lzdGVyQ29tcG9uZW50SW5zdGFuY2UodGhpcywgXCJhdmF0YXItcmVnaW9uLWZvbGxvd2VyXCIpO1xuICAgICAgICBzdWJ0cmFjdEZyb21SZWdpb24odGhpcy5yZWdpb24pXG4gICAgfSxcblxuICAgIHRpY2s6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgbGV0IG5ld1JlZ2lvbiA9IHJlZ2lvblRhZyh0aGlzLmRhdGEuc2l6ZSwgdGhpcy5lbC5vYmplY3QzRClcbiAgICAgICAgaWYgKG5ld1JlZ2lvbiAhPSB0aGlzLnJlZ2lvbikge1xuICAgICAgICAgICAgc3VidHJhY3RGcm9tUmVnaW9uKHRoaXMucmVnaW9uKVxuICAgICAgICAgICAgYWRkVG9SZWdpb24obmV3UmVnaW9uKVxuICAgICAgICAgICAgdGhpcy5yZWdpb24gPSBuZXdSZWdpb25cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG5BRlJBTUUucmVnaXN0ZXJDb21wb25lbnQoJ29iamVjdC1yZWdpb24tZm9sbG93ZXInLCB7XG4gICAgc2NoZW1hOiB7XG4gICAgICAgIHNpemU6IHsgZGVmYXVsdDogMTAgfSxcbiAgICAgICAgZHluYW1pYzogeyBkZWZhdWx0OiB0cnVlIH1cbiAgICB9LFxuICAgIGluaXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5yZWdpb24gPSByZWdpb25UYWcodGhpcy5kYXRhLnNpemUsIHRoaXMuZWwub2JqZWN0M0QpXG5cbiAgICAgICAgdGhpcy5zaG93SGlkZSA9IHRoaXMuc2hvd0hpZGUuYmluZCh0aGlzKVxuICAgICAgICBpZiAodGhpcy5lbC5jb21wb25lbnRzW1wibWVkaWEtdmlkZW9cIl0pIHtcbiAgICAgICAgICAgIHRoaXMud2FzUGF1c2VkID0gdGhpcy5lbC5jb21wb25lbnRzW1wibWVkaWEtdmlkZW9cIl0uZGF0YS52aWRlb1BhdXNlZFxuICAgICAgICB9XG4gICAgICAgIHJlZ2lzdGVyQ29tcG9uZW50SW5zdGFuY2UodGhpcywgXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCIpO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgICAgICBkZXJlZ2lzdGVyQ29tcG9uZW50SW5zdGFuY2UodGhpcywgXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCIpO1xuICAgIH0sXG5cbiAgICB0aWNrOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIG9iamVjdHMgaW4gdGhlIGVudmlyb25tZW50IHNjZW5lIGRvbid0IG1vdmVcbiAgICAgICAgaWYgKCF0aGlzLmRhdGEuZHluYW1pYykgeyByZXR1cm4gfVxuXG4gICAgICAgIHRoaXMucmVnaW9uID0gcmVnaW9uVGFnKHRoaXMuZGF0YS5zaXplLCB0aGlzLmVsLm9iamVjdDNEKVxuXG4gICAgICAgIGxldCB2aXNpYmxlID0gcmVnaW9uc0luVXNlW3RoaXMucmVnaW9uXSA/IHRydWU6IGZhbHNlXG4gICAgICAgIFxuICAgICAgICBpZiAodGhpcy5lbC5vYmplY3QzRC52aXNpYmxlID09IHZpc2libGUpIHsgcmV0dXJuIH1cblxuICAgICAgICAvLyBoYW5kbGUgc2hvdy9oaWRpbmcgdGhlIG9iamVjdHNcbiAgICAgICAgdGhpcy5zaG93SGlkZSh2aXNpYmxlKVxuICAgIH0sXG5cbiAgICBzaG93SGlkZTogZnVuY3Rpb24gKHZpc2libGUpIHtcbiAgICAgICAgLy8gaGFuZGxlIHNob3cvaGlkaW5nIHRoZSBvYmplY3RzXG4gICAgICAgIHRoaXMuZWwub2JqZWN0M0QudmlzaWJsZSA9IHZpc2libGVcblxuICAgICAgICAvLy8gY2hlY2sgZm9yIG1lZGlhLXZpZGVvIGNvbXBvbmVudCBvbiBwYXJlbnQgdG8gc2VlIGlmIHdlJ3JlIGEgdmlkZW8uICBBbHNvIHNhbWUgZm9yIGF1ZGlvXG4gICAgICAgIGlmICh0aGlzLmVsLmNvbXBvbmVudHNbXCJtZWRpYS12aWRlb1wiXSkge1xuICAgICAgICAgICAgaWYgKHZpc2libGUpIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy53YXNQYXVzZWQgIT0gdGhpcy5lbC5jb21wb25lbnRzW1wibWVkaWEtdmlkZW9cIl0uZGF0YS52aWRlb1BhdXNlZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVsLmNvbXBvbmVudHNbXCJtZWRpYS12aWRlb1wiXS50b2dnbGVQbGF5aW5nKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLndhc1BhdXNlZCA9IHRoaXMuZWwuY29tcG9uZW50c1tcIm1lZGlhLXZpZGVvXCJdLmRhdGEudmlkZW9QYXVzZWRcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMud2FzUGF1c2VkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZWwuY29tcG9uZW50c1tcIm1lZGlhLXZpZGVvXCJdLnRvZ2dsZVBsYXlpbmcoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KVxuXG5BRlJBTUUucmVnaXN0ZXJDb21wb25lbnQoJ3JlZ2lvbi1oaWRlcicsIHtcbiAgICBzY2hlbWE6IHtcbiAgICAgICAgLy8gbmFtZSBtdXN0IGZvbGxvdyB0aGUgcGF0dGVybiBcIipfY29tcG9uZW50TmFtZVwiXG4gICAgICAgIHNpemU6IHsgZGVmYXVsdDogMTAgfVxuICAgIH0sXG4gICAgaW5pdDogZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBJZiB0aGVyZSBpcyBhIHBhcmVudCB3aXRoIFwibmF2LW1lc2gtaGVscGVyXCIsIHRoaXMgaXMgaW4gdGhlIHNjZW5lLiAgXG4gICAgICAgIC8vIElmIG5vdCwgaXQncyBpbiBhbiBvYmplY3Qgd2UgZHJvcHBlZCBvbiB0aGUgd2luZG93LCB3aGljaCB3ZSBkb24ndCBzdXBwb3J0XG4gICAgICAgIGlmICghZmluZEFuY2VzdG9yV2l0aENvbXBvbmVudCh0aGlzLmVsLCBcIm5hdi1tZXNoLWhlbHBlclwiKSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKFwicmVnaW9uLWhpZGVyIGNvbXBvbmVudCBtdXN0IGJlIGluIHRoZSBlbnZpcm9ubWVudCBzY2VuZSBnbGIuXCIpXG4gICAgICAgICAgICB0aGlzLnNpemUgPSAwO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICB0aGlzLm5vZGVOYW1lID0gdGhpcy5lbC5wYXJlbnRFbC5wYXJlbnRFbC5jbGFzc05hbWVcbiAgICAgICAgaWYodGhpcy5kYXRhLnNpemUgPT0gMCkge1xuICAgICAgICAgICAgdGhpcy5kYXRhLnNpemUgPSAxMDtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnNpemUgPSB0aGlzLnBhcnNlTm9kZU5hbWUodGhpcy5kYXRhLnNpemUpO1xuXG4gICAgICAgIC8vIHRoaXMubmV3U2NlbmUgPSB0aGlzLm5ld1NjZW5lLmJpbmQodGhpcylcbiAgICAgICAgLy8gdGhpcy5lbC5zY2VuZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJlbnZpcm9ubWVudC1zY2VuZS1sb2FkZWRcIiwgdGhpcy5uZXdTY2VuZSlcbiAgICAgICAgLy8gY29uc3QgZW52aXJvbm1lbnRTY2VuZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIjZW52aXJvbm1lbnQtc2NlbmVcIik7XG4gICAgICAgIC8vIHRoaXMuYWRkU2NlbmVFbGVtZW50ID0gdGhpcy5hZGRTY2VuZUVsZW1lbnQuYmluZCh0aGlzKVxuICAgICAgICAvLyB0aGlzLnJlbW92ZVNjZW5lRWxlbWVudCA9IHRoaXMucmVtb3ZlU2NlbmVFbGVtZW50LmJpbmQodGhpcylcbiAgICAgICAgLy8gZW52aXJvbm1lbnRTY2VuZS5hZGRFdmVudExpc3RlbmVyKFwiY2hpbGQtYXR0YWNoZWRcIiwgdGhpcy5hZGRTY2VuZUVsZW1lbnQpXG4gICAgICAgIC8vIGVudmlyb25tZW50U2NlbmUuYWRkRXZlbnRMaXN0ZW5lcihcImNoaWxkLWRldGFjaGVkXCIsIHRoaXMucmVtb3ZlU2NlbmVFbGVtZW50KVxuXG4gICAgICAgIC8vIHdlIHdhbnQgdG8gbm90aWNlIHdoZW4gbmV3IHRoaW5ncyBnZXQgYWRkZWQgdG8gdGhlIHJvb20uICBUaGlzIHdpbGwgaGFwcGVuIGZvclxuICAgICAgICAvLyBvYmplY3RzIGRyb3BwZWQgaW4gdGhlIHJvb20sIG9yIGZvciBuZXcgcmVtb3RlIGF2YXRhcnMsIGF0IGxlYXN0XG4gICAgICAgIC8vIHRoaXMuYWRkUm9vdEVsZW1lbnQgPSB0aGlzLmFkZFJvb3RFbGVtZW50LmJpbmQodGhpcylcbiAgICAgICAgLy8gdGhpcy5yZW1vdmVSb290RWxlbWVudCA9IHRoaXMucmVtb3ZlUm9vdEVsZW1lbnQuYmluZCh0aGlzKVxuICAgICAgICAvLyB0aGlzLmVsLnNjZW5lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNoaWxkLWF0dGFjaGVkXCIsIHRoaXMuYWRkUm9vdEVsZW1lbnQpXG4gICAgICAgIC8vIHRoaXMuZWwuc2NlbmVFbC5hZGRFdmVudExpc3RlbmVyKFwiY2hpbGQtZGV0YWNoZWRcIiwgdGhpcy5yZW1vdmVSb290RWxlbWVudClcblxuICAgICAgICAvLyB3YW50IHRvIHNlZSBpZiB0aGVyZSBhcmUgcGlubmVkIG9iamVjdHMgdGhhdCB3ZXJlIGxvYWRlZCBmcm9tIGh1YnNcbiAgICAgICAgbGV0IHJvb21PYmplY3RzID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZShcIlJvb21PYmplY3RzXCIpXG4gICAgICAgIHRoaXMucm9vbU9iamVjdHMgPSByb29tT2JqZWN0cy5sZW5ndGggPiAwID8gcm9vbU9iamVjdHNbMF0gOiBudWxsXG5cbiAgICAgICAgLy8gZ2V0IGF2YXRhcnNcbiAgICAgICAgY29uc3QgYXZhdGFycyA9IHRoaXMuZWwuc2NlbmVFbC5xdWVyeVNlbGVjdG9yQWxsKFwiW3BsYXllci1pbmZvXVwiKTtcbiAgICAgICAgYXZhdGFycy5mb3JFYWNoKChhdmF0YXIpID0+IHtcbiAgICAgICAgICAgIGF2YXRhci5zZXRBdHRyaWJ1dGUoXCJhdmF0YXItcmVnaW9uLWZvbGxvd2VyXCIsIHsgc2l6ZTogdGhpcy5zaXplIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIHdhbGsgb2JqZWN0cyBpbiB0aGUgcm9vdCAodGhpbmdzIHRoYXQgaGF2ZSBiZWVuIGRyb3BwZWQgb24gdGhlIHNjZW5lKVxuICAgICAgICAvLyAtIGRyYXdpbmdzIGhhdmUgY2xhc3M9XCJkcmF3aW5nXCIsIG5ldHdvcmtlZC1kcmF3aW5nXG4gICAgICAgIC8vIE5vdCBnb2luZyB0byBkbyBkcmF3aW5ncyByaWdodCBub3cuXG5cbiAgICAgICAgLy8gcGlubmVkIG1lZGlhIGxpdmUgdW5kZXIgYSBub2RlIHdpdGggY2xhc3M9XCJSb29tT2JqZWN0c1wiXG4gICAgICAgIHZhciBub2RlcyA9IHRoaXMuZWwuc2NlbmVFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLlJvb21PYmplY3RzID4gW21lZGlhLWxvYWRlcl1cIik7XG4gICAgICAgIG5vZGVzLmZvckVhY2goKG5vZGUpID0+IHtcbiAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwib2JqZWN0LXJlZ2lvbi1mb2xsb3dlclwiLCB7IHNpemU6IHRoaXMuc2l6ZSB9KVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyAtIGNhbWVyYSBoYXMgY2FtZXJhLXRvb2wgICAgICAgIFxuICAgICAgICAvLyAtIGltYWdlIGZyb20gY2FtZXJhLCBvciBkcm9wcGVkLCBoYXMgbWVkaWEtbG9hZGVyLCBtZWRpYS1pbWFnZSwgbGlzdGVkLW1lZGlhXG4gICAgICAgIC8vIC0gZ2xiIGhhcyBtZWRpYS1sb2FkZXIsIGdsdGYtbW9kZWwtcGx1cywgbGlzdGVkLW1lZGlhXG4gICAgICAgIC8vIC0gdmlkZW8gaGFzIG1lZGlhLWxvYWRlciwgbWVkaWEtdmlkZW8sIGxpc3RlZC1tZWRpYVxuICAgICAgICAvL1xuICAgICAgICAvLyAgc28sIGdldCBhbGwgY2FtZXJhLXRvb2xzLCBhbmQgbWVkaWEtbG9hZGVyIG9iamVjdHMgYXQgdGhlIHRvcCBsZXZlbCBvZiB0aGUgc2NlbmVcbiAgICAgICAgbm9kZXMgPSB0aGlzLmVsLnNjZW5lRWwucXVlcnlTZWxlY3RvckFsbChcIltjYW1lcmEtdG9vbF0sIGEtc2NlbmUgPiBbbWVkaWEtbG9hZGVyXVwiKTtcbiAgICAgICAgbm9kZXMuZm9yRWFjaCgobm9kZSkgPT4ge1xuICAgICAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCIsIHsgc2l6ZTogdGhpcy5zaXplIH0pXG4gICAgICAgIH0pO1xuXG4gICAgICAgIG5vZGVzID0gdGhpcy5lbC5zY2VuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJbY2FtZXJhLXRvb2xdXCIpO1xuICAgICAgICBub2Rlcy5mb3JFYWNoKChub2RlKSA9PiB7XG4gICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcIm9iamVjdC1yZWdpb24tZm9sbG93ZXJcIiwgeyBzaXplOiB0aGlzLnNpemUgfSlcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gd2FsayB0aGUgb2JqZWN0cyBpbiB0aGUgZW52aXJvbm1lbnQgc2NlbmUuICBNdXN0IHdhaXQgZm9yIHNjZW5lIHRvIGZpbmlzaCBsb2FkaW5nXG4gICAgICAgIHRoaXMuc2NlbmVMb2FkZWQgPSB0aGlzLnNjZW5lTG9hZGVkLmJpbmQodGhpcylcbiAgICAgICAgdGhpcy5lbC5zY2VuZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJlbnZpcm9ubWVudC1zY2VuZS1sb2FkZWRcIiwgdGhpcy5zY2VuZUxvYWRlZCk7XG5cbiAgICB9LFxuXG4gICAgLy8gVGhpbmdzIHdlIGRvbid0IHdhbnQgdG8gaGlkZTpcbiAgICAvLyAtIFt3YXlwb2ludF1cbiAgICAvLyAtIHBhcmVudCBvZiBzb21ldGhpbmcgd2l0aCBbbmF2bWVzaF0gYXMgYSBjaGlsZCAodGhpcyBpcyB0aGUgbmF2aWdhdGlvbiBzdHVmZlxuICAgIC8vIC0gdGhpcy5lbC5wYXJlbnRFbC5wYXJlbnRFbFxuICAgIC8vIC0gW3NreWJveF1cbiAgICAvLyAtIFtkaXJlY3Rpb25hbC1saWdodF1cbiAgICAvLyAtIFthbWJpZW50LWxpZ2h0XVxuICAgIC8vIC0gW2hlbWlzcGhlcmUtbGlnaHRdXG4gICAgLy8gLSAjQ29tYmluZWRNZXNoXG4gICAgLy8gLSAjc2NlbmUtcHJldmlldy1jYW1lcmEgb3IgW3NjZW5lLXByZXZpZXctY2FtZXJhXVxuICAgIC8vXG4gICAgLy8gd2Ugd2lsbCBkb1xuICAgIC8vIC0gW21lZGlhLWxvYWRlcl1cbiAgICAvLyAtIFtzcG90LWxpZ2h0XVxuICAgIC8vIC0gW3BvaW50LWxpZ2h0XVxuICAgIHNjZW5lTG9hZGVkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBub2RlcyA9IHRoaXMuZWwucGFyZW50RWwucGFyZW50RWwucGFyZW50RWwuY2hpbGROb2RlcztcbiAgICAgICAgZm9yIChsZXQgaT0wOyBpIDwgbm9kZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGxldCBub2RlID0gbm9kZXNbaV1cbiAgICAgICAgICAgIGlmIChub2RlID09IHRoaXMuZWwucGFyZW50RWwucGFyZW50RWwpIHtjb250aW51ZX1cblxuICAgICAgICAgICAgbGV0IGNsID0gbm9kZS5jbGFzc05hbWVcbiAgICAgICAgICAgIGlmIChjbCA9PT0gXCJDb21iaW5lZE1lc2hcIiB8fCBjbCA9PT0gXCJzY2VuZS1wcmV2aWV3LWNhbWVyYVwiKSB7Y29udGludWV9XG5cbiAgICAgICAgICAgIGxldCBjID0gbm9kZS5jb21wb25lbnRzXG4gICAgICAgICAgICBpZiAoY1tcIndheXBvaW50XCJdIHx8IGNbXCJza3lib3hcIl0gfHwgY1tcImRpcmVjdGlvbmFsLWxpZ2h0XCJdIHx8IGNbXCJhbWJpZW50LWxpZ2h0XCJdIHx8IGNbXCJoZW1pc3BoZXJlLWxpZ2h0XCJdKSB7Y29udGludWV9XG5cbiAgICAgICAgICAgIGxldCBjaCA9IG5vZGUuY2hpbGRyZW5cbiAgICAgICAgICAgIHZhciBuYXZtZXNoID0gZmFsc2U7XG4gICAgICAgICAgICBmb3IgKGxldCBqPTA7IGogPCBjaC5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIGlmIChjaFtqXS5jb21wb25lbnRzW1wibmF2bWVzaFwiXSkge1xuICAgICAgICAgICAgICAgICAgICBuYXZtZXNoID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5hdm1lc2gpIHtjb250aW51ZX1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoXCJvYmplY3QtcmVnaW9uLWZvbGxvd2VyXCIsIHsgc2l6ZTogdGhpcy5zaXplLCBkeW5hbWljOiBmYWxzZSB9KVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gYWxsIG9iamVjdHMgYW5kIGF2YXRhciBzaG91bGQgYmUgc2V0IHVwLCBzbyBsZXRzIG1ha2Ugc3VyZSBhbGwgb2JqZWN0cyBhcmUgY29ycmVjdGx5IHNob3duXG4gICAgICAgIHNob3dIaWRlT2JqZWN0cygpXG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5kYXRhLnNpemUgPT0gMCkge3RoaXMuZGF0YS5zaXplID0gMTB9XG4gICAgICAgIGlmICh0aGlzLmRhdGEuc2l6ZSA9PT0gdGhpcy5zaXplKSByZXR1cm5cblxuICAgICAgICB0aGlzLnNpemUgPSB0aGlzLnBhcnNlTm9kZU5hbWUodGhpcy5kYXRhLnNpemUpO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdGhpcy5lbC5zY2VuZUVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJlbnZpcm9ubWVudC1zY2VuZS1sb2FkZWRcIiwgdGhpcy5zY2VuZUxvYWRlZCk7XG4gICAgfSxcblxuICAgIC8vIHBlciBmcmFtZSBzdHVmZlxuICAgIHRpY2s6IGZ1bmN0aW9uICh0aW1lKSB7XG4gICAgICAgIC8vIHNpemUgPT0gMCBpcyB1c2VkIHRvIHNpZ25hbCBcImRvIG5vdGhpbmdcIlxuICAgICAgICBpZiAodGhpcy5zaXplID09IDApIHtyZXR1cm59XG5cbiAgICAgICAgLy8gc2VlIGlmIHRoZXJlIGFyZSBuZXcgYXZhdGFyc1xuICAgICAgICB2YXIgbm9kZXMgPSB0aGlzLmVsLnNjZW5lRWwucXVlcnlTZWxlY3RvckFsbChcIltwbGF5ZXItaW5mb106bm90KFthdmF0YXItcmVnaW9uLWZvbGxvd2VyXSlcIilcbiAgICAgICAgbm9kZXMuZm9yRWFjaCgoYXZhdGFyKSA9PiB7XG4gICAgICAgICAgICBhdmF0YXIuc2V0QXR0cmlidXRlKFwiYXZhdGFyLXJlZ2lvbi1mb2xsb3dlclwiLCB7IHNpemU6IHRoaXMuc2l6ZSB9KVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyAgc2VlIGlmIHRoZXJlIGFyZSBuZXcgY2FtZXJhLXRvb2xzIG9yIG1lZGlhLWxvYWRlciBvYmplY3RzIGF0IHRoZSB0b3AgbGV2ZWwgb2YgdGhlIHNjZW5lXG4gICAgICAgIG5vZGVzID0gdGhpcy5lbC5zY2VuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJbY2FtZXJhLXRvb2xdOm5vdChbb2JqZWN0LXJlZ2lvbi1mb2xsb3dlcl0pLCBhLXNjZW5lID4gW21lZGlhLWxvYWRlcl06bm90KFtvYmplY3QtcmVnaW9uLWZvbGxvd2VyXSlcIik7XG4gICAgICAgIG5vZGVzLmZvckVhY2goKG5vZGUpID0+IHtcbiAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwib2JqZWN0LXJlZ2lvbi1mb2xsb3dlclwiLCB7IHNpemU6IHRoaXMuc2l6ZSB9KVxuICAgICAgICB9KTtcbiAgICB9LFxuICBcbiAgICAvLyBuZXdTY2VuZTogZnVuY3Rpb24obW9kZWwpIHtcbiAgICAvLyAgICAgY29uc29sZS5sb2coXCJlbnZpcm9ubWVudCBzY2VuZSBsb2FkZWQ6IFwiLCBtb2RlbClcbiAgICAvLyB9LFxuXG4gICAgLy8gYWRkUm9vdEVsZW1lbnQ6IGZ1bmN0aW9uKHsgZGV0YWlsOiB7IGVsIH0gfSkge1xuICAgIC8vICAgICBjb25zb2xlLmxvZyhcImVudGl0eSBhZGRlZCB0byByb290OiBcIiwgZWwpXG4gICAgLy8gfSxcblxuICAgIC8vIHJlbW92ZVJvb3RFbGVtZW50OiBmdW5jdGlvbih7IGRldGFpbDogeyBlbCB9IH0pIHtcbiAgICAvLyAgICAgY29uc29sZS5sb2coXCJlbnRpdHkgcmVtb3ZlZCBmcm9tIHJvb3Q6IFwiLCBlbClcbiAgICAvLyB9LFxuXG4gICAgLy8gYWRkU2NlbmVFbGVtZW50OiBmdW5jdGlvbih7IGRldGFpbDogeyBlbCB9IH0pIHtcbiAgICAvLyAgICAgY29uc29sZS5sb2coXCJlbnRpdHkgYWRkZWQgdG8gZW52aXJvbm1lbnQgc2NlbmU6IFwiLCBlbClcbiAgICAvLyB9LFxuXG4gICAgLy8gcmVtb3ZlU2NlbmVFbGVtZW50OiBmdW5jdGlvbih7IGRldGFpbDogeyBlbCB9IH0pIHtcbiAgICAvLyAgICAgY29uc29sZS5sb2coXCJlbnRpdHkgcmVtb3ZlZCBmcm9tIGVudmlyb25tZW50IHNjZW5lOiBcIiwgZWwpXG4gICAgLy8gfSwgIFxuICAgIFxuICAgIHBhcnNlTm9kZU5hbWU6IGZ1bmN0aW9uIChzaXplKSB7XG4gICAgICAgIC8vIG5vZGVzIHNob3VsZCBiZSBuYW1lZCBhbnl0aGluZyBhdCB0aGUgYmVnaW5uaW5nIHdpdGggXG4gICAgICAgIC8vICBcInNpemVcIiAoYW4gaW50ZWdlciBudW1iZXIpXG4gICAgICAgIC8vIGF0IHRoZSB2ZXJ5IGVuZC4gIFRoaXMgd2lsbCBzZXQgdGhlIGhpZGRlciBjb21wb25lbnQgdG8gXG4gICAgICAgIC8vIHVzZSB0aGF0IHNpemUgaW4gbWV0ZXJzIGZvciB0aGUgcXVhZHJhbnRzXG4gICAgICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMubm9kZU5hbWUubWF0Y2goL18oWzAtOV0qKSQvKVxuXG4gICAgICAgIC8vIGlmIHBhdHRlcm4gbWF0Y2hlcywgd2Ugd2lsbCBoYXZlIGxlbmd0aCBvZiAyLCBmaXJzdCBtYXRjaCBpcyB0aGUgZGlyLFxuICAgICAgICAvLyBzZWNvbmQgaXMgdGhlIGNvbXBvbmVudE5hbWUgbmFtZSBvciBudW1iZXJcbiAgICAgICAgaWYgKCFwYXJhbXMgfHwgcGFyYW1zLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihcInJlZ2lvbi1oaWRlciBjb21wb25lbnROYW1lIG5vdCBmb3JtYXR0ZWQgY29ycmVjdGx5OiBcIiwgdGhpcy5ub2RlTmFtZSlcbiAgICAgICAgICAgIHJldHVybiBzaXplXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgbm9kZVNpemUgPSBwYXJzZUludChwYXJhbXNbMV0pXG4gICAgICAgICAgICBpZiAoIW5vZGVTaXplKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNpemVcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5vZGVTaXplXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59KSIsIi8qKlxuICogRGVzY3JpcHRpb25cbiAqID09PT09PT09PT09XG4gKiBCaWRpcmVjdGlvbmFsIHNlZS10aHJvdWdoIHBvcnRhbC4gVHdvIHBvcnRhbHMgYXJlIHBhaXJlZCBieSBjb2xvci5cbiAqXG4gKiBVc2FnZVxuICogPT09PT09PVxuICogQWRkIHR3byBpbnN0YW5jZXMgb2YgYHBvcnRhbC5nbGJgIHRvIHRoZSBTcG9rZSBzY2VuZS5cbiAqIFRoZSBuYW1lIG9mIGVhY2ggaW5zdGFuY2Ugc2hvdWxkIGxvb2sgbGlrZSBcInNvbWUtZGVzY3JpcHRpdmUtbGFiZWxfX2NvbG9yXCJcbiAqIEFueSB2YWxpZCBUSFJFRS5Db2xvciBhcmd1bWVudCBpcyBhIHZhbGlkIGNvbG9yIHZhbHVlLlxuICogU2VlIGhlcmUgZm9yIGV4YW1wbGUgY29sb3IgbmFtZXMgaHR0cHM6Ly93d3cudzNzY2hvb2xzLmNvbS9jc3NyZWYvY3NzX2NvbG9ycy5hc3BcbiAqXG4gKiBGb3IgZXhhbXBsZSwgdG8gbWFrZSBhIHBhaXIgb2YgY29ubmVjdGVkIGJsdWUgcG9ydGFscyxcbiAqIHlvdSBjb3VsZCBuYW1lIHRoZW0gXCJwb3J0YWwtdG9fX2JsdWVcIiBhbmQgXCJwb3J0YWwtZnJvbV9fYmx1ZVwiXG4gKi9cblxuaW1wb3J0ICcuL3Byb3hpbWl0eS1ldmVudHMuanMnXG5pbXBvcnQgdmVydGV4U2hhZGVyIGZyb20gJy4uL3NoYWRlcnMvcG9ydGFsLnZlcnQuanMnXG5pbXBvcnQgZnJhZ21lbnRTaGFkZXIgZnJvbSAnLi4vc2hhZGVycy9wb3J0YWwuZnJhZy5qcydcbmltcG9ydCBzbm9pc2UgZnJvbSAnLi4vc2hhZGVycy9zbm9pc2UuanMnXG5pbXBvcnQgeyBzaG93UmVnaW9uRm9yT2JqZWN0LCBoaWRlclJlZ2lvbkZvck9iamVjdCB9IGZyb20gJy4vcmVnaW9uLWhpZGVyLmpzJ1xuXG5jb25zdCB3b3JsZFBvcyA9IG5ldyBUSFJFRS5WZWN0b3IzKClcbmNvbnN0IHdvcmxkQ2FtZXJhUG9zID0gbmV3IFRIUkVFLlZlY3RvcjMoKVxuY29uc3Qgd29ybGREaXIgPSBuZXcgVEhSRUUuVmVjdG9yMygpXG5jb25zdCB3b3JsZFF1YXQgPSBuZXcgVEhSRUUuUXVhdGVybmlvbigpXG5jb25zdCBtYXQ0ID0gbmV3IFRIUkVFLk1hdHJpeDQoKVxuXG5BRlJBTUUucmVnaXN0ZXJTeXN0ZW0oJ3BvcnRhbCcsIHtcbiAgZGVwZW5kZW5jaWVzOiBbJ2ZhZGVyLXBsdXMnXSxcbiAgaW5pdDogZnVuY3Rpb24gKCkge1xuICAgIHRoaXMudGVsZXBvcnRpbmcgPSBmYWxzZVxuICAgIHRoaXMuY2hhcmFjdGVyQ29udHJvbGxlciA9IHRoaXMuZWwuc3lzdGVtc1snaHVicy1zeXN0ZW1zJ10uY2hhcmFjdGVyQ29udHJvbGxlclxuICAgIHRoaXMuZmFkZXIgPSB0aGlzLmVsLnN5c3RlbXNbJ2ZhZGVyLXBsdXMnXVxuICAgIHRoaXMucm9vbURhdGEgPSBudWxsXG4gICAgdGhpcy53YWl0Rm9yRmV0Y2ggPSB0aGlzLndhaXRGb3JGZXRjaC5iaW5kKHRoaXMpXG5cbiAgICAvLyBpZiB0aGUgdXNlciBpcyBsb2dnZWQgaW4sIHdlIHdhbnQgdG8gcmV0cmlldmUgdGhlaXIgdXNlckRhdGEgZnJvbSB0aGUgdG9wIGxldmVsIHNlcnZlclxuICAgIGlmICh3aW5kb3cuQVBQLnN0b3JlLnN0YXRlLmNyZWRlbnRpYWxzICYmIHdpbmRvdy5BUFAuc3RvcmUuc3RhdGUuY3JlZGVudGlhbHMudG9rZW4gJiYgIXdpbmRvdy5BUFAudXNlckRhdGEpIHtcbiAgICAgICAgdGhpcy5mZXRjaFJvb21EYXRhKClcbiAgICB9XG4gIH0sXG4gIGZldGNoUm9vbURhdGE6IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcGFyYW1zID0ge3Rva2VuOiB3aW5kb3cuQVBQLnN0b3JlLnN0YXRlLmNyZWRlbnRpYWxzLnRva2VuLFxuICAgICAgICAgICAgICAgICAgcm9vbV9pZDogd2luZG93LkFQUC5odWJDaGFubmVsLmh1YklkfVxuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHt9O1xuICAgIG9wdGlvbnMuaGVhZGVycyA9IG5ldyBIZWFkZXJzKCk7XG4gICAgb3B0aW9ucy5oZWFkZXJzLnNldChcIkF1dGhvcml6YXRpb25cIiwgYEJlYXJlciAke3BhcmFtc31gKTtcbiAgICBvcHRpb25zLmhlYWRlcnMuc2V0KFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvblwiKTtcbiAgICBhd2FpdCBmZXRjaChcImh0dHBzOi8vcmVhbGl0eW1lZGlhLmRpZ2l0YWwvdXNlckRhdGFcIiwgb3B0aW9ucylcbiAgICAgICAgLnRoZW4ocmVzcG9uc2UgPT4gcmVzcG9uc2UuanNvbigpKVxuICAgICAgICAudGhlbihkYXRhID0+IHtcbiAgICAgICAgICBjb25zb2xlLmxvZygnU3VjY2VzczonLCBkYXRhKTtcbiAgICAgICAgICB0aGlzLnJvb21EYXRhID0gZGF0YTtcbiAgICB9KVxuICAgIHRoaXMucm9vbURhdGEudGV4dHVyZXMgPSBbXVxuICB9LFxuICBnZXRSb29tVVJMOiBhc3luYyBmdW5jdGlvbiAobnVtYmVyKSB7XG4gICAgICB0aGlzLndhaXRGb3JGZXRjaCgpXG4gICAgICByZXR1cm4gdGhpcy5yb29tRGF0YS5yb29tcy5sZW5ndGggPiBudW1iZXIgPyBcImh0dHBzOi8veHIucmVhbGl0eW1lZGlhLmRpZ2l0YWwvXCIgKyB0aGlzLnJvb21EYXRhLnJvb21zW251bWJlcl0gOiBudWxsO1xuICB9LFxuICBnZXRDdWJlTWFwOiBhc3luYyBmdW5jdGlvbiAobnVtYmVyKSB7XG4gICAgICB0aGlzLndhaXRGb3JGZXRjaCgpXG4gICAgICByZXR1cm4gdGhpcy5yb29tRGF0YS5jdWJlbWFwcy5sZW5ndGggPiBudW1iZXIgPyB0aGlzLnJvb21EYXRhLmN1YmVtYXBzW251bWJlcl0gOiBudWxsO1xuICB9LFxuICB3YWl0Rm9yRmV0Y2g6IGZ1bmN0aW9uICgpIHtcbiAgICAgaWYgKHRoaXMucm9vbURhdGEpIHJldHVyblxuICAgICBzZXRUaW1lb3V0KHRoaXMud2FpdEZvckZldGNoLCAxMDApOyAvLyB0cnkgYWdhaW4gaW4gMTAwIG1pbGxpc2Vjb25kc1xuICB9LFxuICB0ZWxlcG9ydFRvOiBhc3luYyBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgdGhpcy50ZWxlcG9ydGluZyA9IHRydWVcbiAgICBhd2FpdCB0aGlzLmZhZGVyLmZhZGVPdXQoKVxuICAgIC8vIFNjYWxlIHNjcmV3cyB1cCB0aGUgd2F5cG9pbnQgbG9naWMsIHNvIGp1c3Qgc2VuZCBwb3NpdGlvbiBhbmQgb3JpZW50YXRpb25cbiAgICBvYmplY3QuZ2V0V29ybGRRdWF0ZXJuaW9uKHdvcmxkUXVhdClcbiAgICBvYmplY3QuZ2V0V29ybGREaXJlY3Rpb24od29ybGREaXIpXG4gICAgb2JqZWN0LmdldFdvcmxkUG9zaXRpb24od29ybGRQb3MpXG4gICAgd29ybGRQb3MuYWRkKHdvcmxkRGlyLm11bHRpcGx5U2NhbGFyKDEuNSkpIC8vIFRlbGVwb3J0IGluIGZyb250IG9mIHRoZSBwb3J0YWwgdG8gYXZvaWQgaW5maW5pdGUgbG9vcFxuICAgIG1hdDQubWFrZVJvdGF0aW9uRnJvbVF1YXRlcm5pb24od29ybGRRdWF0KVxuICAgIG1hdDQuc2V0UG9zaXRpb24od29ybGRQb3MpXG4gICAgLy8gVXNpbmcgdGhlIGNoYXJhY3RlckNvbnRyb2xsZXIgZW5zdXJlcyB3ZSBkb24ndCBzdHJheSBmcm9tIHRoZSBuYXZtZXNoXG4gICAgdGhpcy5jaGFyYWN0ZXJDb250cm9sbGVyLnRyYXZlbEJ5V2F5cG9pbnQobWF0NCwgdHJ1ZSwgZmFsc2UpXG4gICAgYXdhaXQgdGhpcy5mYWRlci5mYWRlSW4oKVxuICAgIHRoaXMudGVsZXBvcnRpbmcgPSBmYWxzZVxuICB9LFxufSlcblxuQUZSQU1FLnJlZ2lzdGVyQ29tcG9uZW50KCdwb3J0YWwnLCB7XG4gIHNjaGVtYToge1xuICAgIGNvbG9yOiB7IHR5cGU6ICdjb2xvcicsIGRlZmF1bHQ6IG51bGwgfSxcbiAgfSxcbiAgaW5pdDogYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuc3lzdGVtID0gQVBQLnNjZW5lLnN5c3RlbXMucG9ydGFsIC8vIEEtRnJhbWUgaXMgc3VwcG9zZWQgdG8gZG8gdGhpcyBieSBkZWZhdWx0IGJ1dCBkb2Vzbid0P1xuXG4gICAgLy8gcGFyc2UgdGhlIG5hbWUgdG8gZ2V0IHBvcnRhbCB0eXBlLCB0YXJnZXQsIGFuZCBjb2xvclxuICAgIHRoaXMucGFyc2VOb2RlTmFtZSgpXG5cbiAgICB0aGlzLm1hdGVyaWFsID0gbmV3IFRIUkVFLlNoYWRlck1hdGVyaWFsKHtcbiAgICAgIHRyYW5zcGFyZW50OiB0cnVlLFxuICAgICAgc2lkZTogVEhSRUUuRG91YmxlU2lkZSxcbiAgICAgIHVuaWZvcm1zOiB7XG4gICAgICAgIGN1YmVNYXA6IHsgdmFsdWU6IG5ldyBUSFJFRS5UZXh0dXJlKCkgfSxcbiAgICAgICAgdGltZTogeyB2YWx1ZTogMCB9LFxuICAgICAgICByYWRpdXM6IHsgdmFsdWU6IDAgfSxcbiAgICAgICAgcmluZ0NvbG9yOiB7IHZhbHVlOiB0aGlzLmNvbG9yIH0sXG4gICAgICB9LFxuICAgICAgdmVydGV4U2hhZGVyLFxuICAgICAgZnJhZ21lbnRTaGFkZXI6IGBcbiAgICAgICAgJHtzbm9pc2V9XG4gICAgICAgICR7ZnJhZ21lbnRTaGFkZXJ9XG4gICAgICBgLFxuICAgIH0pXG5cbiAgICAvLyBBc3N1bWUgdGhhdCB0aGUgb2JqZWN0IGhhcyBhIHBsYW5lIGdlb21ldHJ5XG4gICAgY29uc3QgbWVzaCA9IHRoaXMuZWwuZ2V0T3JDcmVhdGVPYmplY3QzRCgnbWVzaCcpXG4gICAgbWVzaC5tYXRlcmlhbCA9IHRoaXMubWF0ZXJpYWxcblxuICAgIC8vIGdldCB0aGUgb3RoZXIgYmVmb3JlIGNvbnRpbnVpbmdcbiAgICB0aGlzLm90aGVyID0gYXdhaXQgdGhpcy5nZXRPdGhlcigpXG5cbiAgICBpZiAodGhpcy5wb3J0YWxUeXBlID09IDEpIHtcbiAgICAgICAgdGhpcy5zeXN0ZW0uZ2V0Q3ViZU1hcCh0aGlzLnBvcnRhbFRhcmdldCkudGhlbiggdXJscyA9PiB7XG4gICAgICAgICAgICAvL2NvbnN0IHVybHMgPSBbY3ViZU1hcFBvc1gsIGN1YmVNYXBOZWdYLCBjdWJlTWFwUG9zWSwgY3ViZU1hcE5lZ1ksIGN1YmVNYXBQb3NaLCBjdWJlTWFwTmVnWl07XG4gICAgICAgICAgICBjb25zdCB0ZXh0dXJlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT5cbiAgICAgICAgICAgICAgbmV3IFRIUkVFLkN1YmVUZXh0dXJlTG9hZGVyKCkubG9hZCh1cmxzLCByZXNvbHZlLCB1bmRlZmluZWQsIHJlamVjdClcbiAgICAgICAgICAgICkudGhlbih0ZXh0dXJlID0+IHtcbiAgICAgICAgICAgICAgICB0ZXh0dXJlLmZvcm1hdCA9IFRIUkVFLlJHQkZvcm1hdDtcbiAgICAgICAgICAgICAgICB0aGlzLm1hdGVyaWFsLnVuaWZvcm1zLmN1YmVNYXAudmFsdWUgPSB0ZXh0dXJlO1xuICAgICAgICAgICAgfSkuY2F0Y2goZSA9PiBjb25zb2xlLmVycm9yKGUpKSAgICBcbiAgICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHRoaXMucG9ydGFsVHlwZSA9PSAyKSB7ICAgIFxuICAgICAgICB0aGlzLmN1YmVDYW1lcmEgPSBuZXcgVEhSRUUuQ3ViZUNhbWVyYSgxLCAxMDAwMDAsIDEwMjQpXG4gICAgICAgIHRoaXMuY3ViZUNhbWVyYS5yb3RhdGVZKE1hdGguUEkpIC8vIEZhY2UgZm9yd2FyZHNcbiAgICAgICAgdGhpcy5lbC5vYmplY3QzRC5hZGQodGhpcy5jdWJlQ2FtZXJhKVxuICAgICAgICB0aGlzLm90aGVyLmNvbXBvbmVudHMucG9ydGFsLm1hdGVyaWFsLnVuaWZvcm1zLmN1YmVNYXAudmFsdWUgPSB0aGlzLmN1YmVDYW1lcmEucmVuZGVyVGFyZ2V0LnRleHR1cmVcbiAgICAgICAgdGhpcy5lbC5zY2VuZUVsLmFkZEV2ZW50TGlzdGVuZXIoJ21vZGVsLWxvYWRlZCcsICgpID0+IHtcbiAgICAgICAgICAgIHNob3dSZWdpb25Gb3JPYmplY3QodGhpcy5lbClcbiAgICAgICAgICAgIHRoaXMuY3ViZUNhbWVyYS51cGRhdGUodGhpcy5lbC5zY2VuZUVsLnJlbmRlcmVyLCB0aGlzLmVsLnNjZW5lRWwub2JqZWN0M0QpXG4gICAgICAgICAgICBoaWRlclJlZ2lvbkZvck9iamVjdCh0aGlzLmVsKVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdhbmltYXRpb25fX3BvcnRhbCcsIHtcbiAgICAgICAgcHJvcGVydHk6ICdjb21wb25lbnRzLnBvcnRhbC5tYXRlcmlhbC51bmlmb3Jtcy5yYWRpdXMudmFsdWUnLFxuICAgICAgICBkdXI6IDcwMCxcbiAgICAgICAgZWFzaW5nOiAnZWFzZUluT3V0Q3ViaWMnLFxuICAgIH0pXG4gICAgdGhpcy5lbC5hZGRFdmVudExpc3RlbmVyKCdhbmltYXRpb25iZWdpbicsICgpID0+ICh0aGlzLmVsLm9iamVjdDNELnZpc2libGUgPSB0cnVlKSlcbiAgICB0aGlzLmVsLmFkZEV2ZW50TGlzdGVuZXIoJ2FuaW1hdGlvbmNvbXBsZXRlX19wb3J0YWwnLCAoKSA9PiAodGhpcy5lbC5vYmplY3QzRC52aXNpYmxlID0gIXRoaXMuaXNDbG9zZWQoKSkpXG5cbiAgICAvLyBnb2luZyB0byB3YW50IHRvIHRyeSBhbmQgbWFrZSB0aGUgb2JqZWN0IHRoaXMgcG9ydGFsIGlzIG9uIGNsaWNrYWJsZVxuICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdpcy1yZW1vdGUtaG92ZXItdGFyZ2V0JywnJylcbiAgICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgndGFncycsIHtzaW5nbGVBY3Rpb25CdXR0b246IHRydWV9KVxuICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdjbGFzcycsIFwiaW50ZXJhY3RhYmxlXCIpXG4gICAgLy8gb3J3YXJkIHRoZSAnaW50ZXJhY3QnIGV2ZW50cyB0byBvdXIgcG9ydGFsIG1vdmVtZW50IFxuICAgIHRoaXMuZm9sbG93UG9ydGFsID0gdGhpcy5mb2xsb3dQb3J0YWwuYmluZCh0aGlzKVxuICAgIHRoaXMuZWwub2JqZWN0M0QuYWRkRXZlbnRMaXN0ZW5lcignaW50ZXJhY3QnLCB0aGlzLmZvbGxvd1BvcnRhbClcblxuICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdwcm94aW1pdHktZXZlbnRzJywgeyByYWRpdXM6IDUgfSlcbiAgICB0aGlzLmVsLmFkZEV2ZW50TGlzdGVuZXIoJ3Byb3hpbWl0eWVudGVyJywgKCkgPT4gdGhpcy5vcGVuKCkpXG4gICAgdGhpcy5lbC5hZGRFdmVudExpc3RlbmVyKCdwcm94aW1pdHlsZWF2ZScsICgpID0+IHRoaXMuY2xvc2UoKSlcbiAgfSxcblxuICBmb2xsb3dQb3J0YWw6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLnBvcnRhbFR5cGUgPT0gMSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcInNldCB3aW5kb3cubG9jYXRpb24uaHJlZiB0byBcIiArIHRoaXMub3RoZXIpXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5ocmVmID0gdGhpcy5vdGhlclxuICAgICAgfSBlbHNlIGlmICh0aGlzLnBvcnRhbFR5cGUgPT0gMikge1xuICAgICAgICB0aGlzLnN5c3RlbS50ZWxlcG9ydFRvKHRoaXMub3RoZXIub2JqZWN0M0QpXG4gICAgICB9XG4gIH0sXG4gIHRpY2s6IGZ1bmN0aW9uICh0aW1lKSB7XG4gICAgdGhpcy5tYXRlcmlhbC51bmlmb3Jtcy50aW1lLnZhbHVlID0gdGltZSAvIDEwMDBcbiAgICAgICAgXG4gICAgaWYgKHRoaXMub3RoZXIgJiYgIXRoaXMuc3lzdGVtLnRlbGVwb3J0aW5nKSB7XG4gICAgICB0aGlzLmVsLm9iamVjdDNELmdldFdvcmxkUG9zaXRpb24od29ybGRQb3MpXG4gICAgICB0aGlzLmVsLnNjZW5lRWwuY2FtZXJhLmdldFdvcmxkUG9zaXRpb24od29ybGRDYW1lcmFQb3MpXG4gICAgICBjb25zdCBkaXN0ID0gd29ybGRDYW1lcmFQb3MuZGlzdGFuY2VUbyh3b3JsZFBvcylcblxuICAgICAgaWYgKHRoaXMucG9ydGFsVHlwZSA9PSAxICYmIGRpc3QgPCAwLjUpIHtcbiAgICAgICAgLy9jb25zb2xlLmxvZyhcInNldCB3aW5kb3cubG9jYXRpb24uaHJlZiB0byBcIiArIHRoaXMub3RoZXIpXG4gICAgICAgIC8vd2luZG93LmxvY2F0aW9uLmhyZWYgPSB0aGlzLm90aGVyXG4gICAgICB9IGVsc2UgaWYgKHRoaXMucG9ydGFsVHlwZSA9PSAyICYmIGRpc3QgPCAxKSB7XG4gICAgICAgIHRoaXMuc3lzdGVtLnRlbGVwb3J0VG8odGhpcy5vdGhlci5vYmplY3QzRClcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIGdldE90aGVyOiBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnBvcnRhbFR5cGUgPT0gMCkgcmVzb2x2ZShudWxsKVxuICAgICAgICBpZiAodGhpcy5wb3J0YWxUeXBlICA9PSAxKSB7XG4gICAgICAgICAgICAvLyB0aGUgdGFyZ2V0IGlzIGFub3RoZXIgcm9vbSwgcmVzb2x2ZSB3aXRoIHRoZSBVUkwgdG8gdGhlIHJvb21cbiAgICAgICAgICAgIHRoaXMuc3lzdGVtLmdldFJvb21VUkwodGhpcy5wb3J0YWxUYXJnZXQpLnRoZW4odXJsID0+IHsgcmVzb2x2ZSh1cmwpIH0pXG4gICAgICAgIH1cblxuICAgICAgICAvLyBub3cgZmluZCB0aGUgcG9ydGFsIHdpdGhpbiB0aGUgcm9vbS4gIFRoZSBwb3J0YWxzIHNob3VsZCBjb21lIGluIHBhaXJzIHdpdGggdGhlIHNhbWUgcG9ydGFsVGFyZ2V0XG4gICAgICAgIGNvbnN0IHBvcnRhbHMgPSBBcnJheS5mcm9tKGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoYFtwb3J0YWxdYCkpXG4gICAgICAgIGNvbnN0IG90aGVyID0gcG9ydGFscy5maW5kKChlbCkgPT4gZWwuY29tcG9uZW50cy5wb3J0YWwucG9ydGFsVHlwZSA9PSB0aGlzLnBvcnRhbFR5cGUgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbC5jb21wb25lbnRzLnBvcnRhbC5wb3J0YWxUYXJnZXQgPT09IHRoaXMucG9ydGFsVGFyZ2V0ICYmIGVsICE9PSB0aGlzLmVsKVxuICAgICAgICBpZiAob3RoZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQ2FzZSAxOiBUaGUgb3RoZXIgcG9ydGFsIGFscmVhZHkgZXhpc3RzXG4gICAgICAgICAgICByZXNvbHZlKG90aGVyKVxuICAgICAgICAgICAgb3RoZXIuZW1pdCgncGFpcicsIHsgb3RoZXI6IHRoaXMuZWwgfSkgLy8gTGV0IHRoZSBvdGhlciBrbm93IHRoYXQgd2UncmUgcmVhZHlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIENhc2UgMjogV2UgY291bGRuJ3QgZmluZCB0aGUgb3RoZXIgcG9ydGFsLCB3YWl0IGZvciBpdCB0byBzaWduYWwgdGhhdCBpdCdzIHJlYWR5XG4gICAgICAgICAgICB0aGlzLmVsLmFkZEV2ZW50TGlzdGVuZXIoJ3BhaXInLCAoZXZlbnQpID0+IHJlc29sdmUoZXZlbnQuZGV0YWlsLm90aGVyKSwgeyBvbmNlOiB0cnVlIH0pXG4gICAgICAgIH1cbiAgICB9KVxuICB9LFxuXG4gIHBhcnNlTm9kZU5hbWU6IGZ1bmN0aW9uICgpIHtcbiAgICBjb25zdCBub2RlTmFtZSA9IHRoaXMuZWwucGFyZW50RWwucGFyZW50RWwuY2xhc3NOYW1lXG5cbiAgICAvLyBub2RlcyBzaG91bGQgYmUgbmFtZWQgYW55dGhpbmcgYXQgdGhlIGJlZ2lubmluZyB3aXRoIGVpdGhlciBcbiAgICAvLyAtIFwicm9vbV9uYW1lX2NvbG9yXCJcbiAgICAvLyAtIFwicG9ydGFsX05fY29sb3JcIiBcbiAgICAvLyBhdCB0aGUgdmVyeSBlbmQuIE51bWJlcmVkIHBvcnRhbHMgc2hvdWxkIGNvbWUgaW4gcGFpcnMuXG4gICAgY29uc3QgcGFyYW1zID0gbm9kZU5hbWUubWF0Y2goLyhbQS1aYS16XSopXyhbQS1aYS16MC05XSopXyhbQS1aYS16MC05XSopJC8pXG4gICAgXG4gICAgLy8gaWYgcGF0dGVybiBtYXRjaGVzLCB3ZSB3aWxsIGhhdmUgbGVuZ3RoIG9mIDQsIGZpcnN0IG1hdGNoIGlzIHRoZSBwb3J0YWwgdHlwZSxcbiAgICAvLyBzZWNvbmQgaXMgdGhlIG5hbWUgb3IgbnVtYmVyLCBhbmQgbGFzdCBpcyB0aGUgY29sb3JcbiAgICBpZiAoIXBhcmFtcyB8fCBwYXJhbXMubGVuZ3RoIDwgNCkge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJwb3J0YWwgbm9kZSBuYW1lIG5vdCBmb3JtZWQgY29ycmVjdGx5OiBcIiwgbm9kZU5hbWUpXG4gICAgICAgIHRoaXMucG9ydGFsVHlwZSA9IDBcbiAgICAgICAgdGhpcy5wb3J0YWxUYXJnZXQgPSBudWxsXG4gICAgICAgIHRoaXMuY29sb3IgPSBcInJlZFwiIC8vIGRlZmF1bHQgc28gdGhlIHBvcnRhbCBoYXMgYSBjb2xvciB0byB1c2VcbiAgICAgICAgcmV0dXJuO1xuICAgIH0gXG4gICAgaWYgKHBhcmFtc1sxXSA9PT0gXCJyb29tXCIpIHtcbiAgICAgICAgdGhpcy5wb3J0YWxUeXBlID0gMTtcbiAgICAgICAgdGhpcy5wb3J0YWxUYXJnZXQgPSBwYXJzZUludChwYXJhbXNbMl0pXG4gICAgfSBlbHNlIGlmIChwYXJhbXNbMV0gPT09IFwicG9ydGFsXCIpIHtcbiAgICAgICAgdGhpcy5wb3J0YWxUeXBlID0gMjtcbiAgICAgICAgdGhpcy5wb3J0YWxUYXJnZXQgPSBwYXJhbXNbMl1cbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnBvcnRhbFR5cGUgPSAwO1xuICAgICAgICB0aGlzLnBvcnRhbFRhcmdldCA9IG51bGxcbiAgICB9IFxuICAgIHRoaXMuY29sb3IgPSBuZXcgVEhSRUUuQ29sb3IocGFyYW1zWzNdKVxuICB9LFxuXG4gIHNldFJhZGl1cyh2YWwpIHtcbiAgICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnYW5pbWF0aW9uX19wb3J0YWwnLCB7XG4gICAgICBmcm9tOiB0aGlzLm1hdGVyaWFsLnVuaWZvcm1zLnJhZGl1cy52YWx1ZSxcbiAgICAgIHRvOiB2YWwsXG4gICAgfSlcbiAgfSxcbiAgb3BlbigpIHtcbiAgICB0aGlzLnNldFJhZGl1cygxKVxuICB9LFxuICBjbG9zZSgpIHtcbiAgICB0aGlzLnNldFJhZGl1cygwKVxuICB9LFxuICBpc0Nsb3NlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5tYXRlcmlhbC51bmlmb3Jtcy5yYWRpdXMudmFsdWUgPT09IDBcbiAgfSxcbn0pXG4iLCIvKipcbiAqIERlc2NyaXB0aW9uXG4gKiA9PT09PT09PT09PVxuICogMzYwIGltYWdlIHRoYXQgZmlsbHMgdGhlIHVzZXIncyB2aXNpb24gd2hlbiBpbiBhIGNsb3NlIHByb3hpbWl0eS5cbiAqXG4gKiBVc2FnZVxuICogPT09PT09PVxuICogR2l2ZW4gYSAzNjAgaW1hZ2UgYXNzZXQgd2l0aCB0aGUgZm9sbG93aW5nIFVSTCBpbiBTcG9rZTpcbiAqIGh0dHBzOi8vZ3QtYWVsLWFxLWFzc2V0cy5hZWxhdGd0LWludGVybmFsLm5ldC9maWxlcy8xMjM0NWFiYy02Nzg5ZGVmLmpwZ1xuICpcbiAqIFRoZSBuYW1lIG9mIHRoZSBgaW1tZXJzaXZlLTM2MC5nbGJgIGluc3RhbmNlIGluIHRoZSBzY2VuZSBzaG91bGQgYmU6XG4gKiBcInNvbWUtZGVzY3JpcHRpdmUtbGFiZWxfXzEyMzQ1YWJjLTY3ODlkZWZfanBnXCIgT1IgXCIxMjM0NWFiYy02Nzg5ZGVmX2pwZ1wiXG4gKi9cblxuY29uc3Qgd29ybGRDYW1lcmEgPSBuZXcgVEhSRUUuVmVjdG9yMygpXG5jb25zdCB3b3JsZFNlbGYgPSBuZXcgVEhSRUUuVmVjdG9yMygpXG5cbkFGUkFNRS5yZWdpc3RlckNvbXBvbmVudCgnaW1tZXJzaXZlLTM2MCcsIHtcbiAgc2NoZW1hOiB7XG4gICAgdXJsOiB7IHR5cGU6ICdzdHJpbmcnLCBkZWZhdWx0OiBudWxsIH0sXG4gIH0sXG4gIGluaXQ6IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICBjb25zdCB1cmwgPSB0aGlzLmRhdGEudXJsID8/IHRoaXMucGFyc2VTcG9rZU5hbWUoKVxuICAgIGNvbnN0IGV4dGVuc2lvbiA9IHVybC5tYXRjaCgvXi4qXFwuKC4qKSQvKVsxXVxuXG4gICAgLy8gbWVkaWEtaW1hZ2Ugd2lsbCBzZXQgdXAgdGhlIHNwaGVyZSBnZW9tZXRyeSBmb3IgdXNcbiAgICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnbWVkaWEtaW1hZ2UnLCB7XG4gICAgICBwcm9qZWN0aW9uOiAnMzYwLWVxdWlyZWN0YW5ndWxhcicsXG4gICAgICBhbHBoYU1vZGU6ICdvcGFxdWUnLFxuICAgICAgc3JjOiB1cmwsXG4gICAgICB2ZXJzaW9uOiAxLFxuICAgICAgYmF0Y2g6IGZhbHNlLFxuICAgICAgY29udGVudFR5cGU6IGBpbWFnZS8ke2V4dGVuc2lvbn1gLFxuICAgICAgYWxwaGFDdXRvZmY6IDAsXG4gICAgfSlcbiAgICAvLyBidXQgd2UgbmVlZCB0byB3YWl0IGZvciB0aGlzIHRvIGhhcHBlblxuICAgIHRoaXMubWVzaCA9IGF3YWl0IHRoaXMuZ2V0TWVzaCgpXG4gICAgdGhpcy5tZXNoLmdlb21ldHJ5LnNjYWxlKDEwMCwgMTAwLCAxMDApXG4gICAgdGhpcy5tZXNoLm1hdGVyaWFsLnNldFZhbHVlcyh7XG4gICAgICB0cmFuc3BhcmVudDogdHJ1ZSxcbiAgICAgIGRlcHRoVGVzdDogZmFsc2UsXG4gICAgfSlcbiAgICB0aGlzLm5lYXIgPSAxXG4gICAgdGhpcy5mYXIgPSAxLjNcblxuICAgIC8vIFJlbmRlciBPVkVSIHRoZSBzY2VuZSBidXQgVU5ERVIgdGhlIGN1cnNvclxuICAgIHRoaXMubWVzaC5yZW5kZXJPcmRlciA9IEFQUC5SRU5ERVJfT1JERVIuQ1VSU09SIC0gMVxuICB9LFxuICB0aWNrOiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMubWVzaCkge1xuICAgICAgLy8gTGluZWFybHkgbWFwIGNhbWVyYSBkaXN0YW5jZSB0byBtYXRlcmlhbCBvcGFjaXR5XG4gICAgICB0aGlzLm1lc2guZ2V0V29ybGRQb3NpdGlvbih3b3JsZFNlbGYpXG4gICAgICB0aGlzLmVsLnNjZW5lRWwuY2FtZXJhLmdldFdvcmxkUG9zaXRpb24od29ybGRDYW1lcmEpXG4gICAgICBjb25zdCBkaXN0YW5jZSA9IHdvcmxkU2VsZi5kaXN0YW5jZVRvKHdvcmxkQ2FtZXJhKVxuICAgICAgY29uc3Qgb3BhY2l0eSA9IDEgLSAoZGlzdGFuY2UgLSB0aGlzLm5lYXIpIC8gKHRoaXMuZmFyIC0gdGhpcy5uZWFyKVxuICAgICAgdGhpcy5tZXNoLm1hdGVyaWFsLm9wYWNpdHkgPSBvcGFjaXR5XG4gICAgfVxuICB9LFxuICBwYXJzZVNwb2tlTmFtZTogZnVuY3Rpb24gKCkge1xuICAgIC8vIEFjY2VwdGVkIG5hbWVzOiBcImxhYmVsX19pbWFnZS1oYXNoX2V4dFwiIE9SIFwiaW1hZ2UtaGFzaF9leHRcIlxuICAgIGNvbnN0IHNwb2tlTmFtZSA9IHRoaXMuZWwucGFyZW50RWwucGFyZW50RWwuY2xhc3NOYW1lXG4gICAgY29uc3QgWywgaGFzaCwgZXh0ZW5zaW9uXSA9IHNwb2tlTmFtZS5tYXRjaCgvKD86LipfXyk/KC4qKV8oLiopLylcbiAgICBjb25zdCB1cmwgPSBgaHR0cHM6Ly9ndC1hZWwtYXEtYXNzZXRzLmFlbGF0Z3QtaW50ZXJuYWwubmV0L2ZpbGVzLyR7aGFzaH0uJHtleHRlbnNpb259YFxuICAgIHJldHVybiB1cmxcbiAgfSxcbiAgZ2V0TWVzaDogYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgbWVzaCA9IHRoaXMuZWwub2JqZWN0M0RNYXAubWVzaFxuICAgICAgaWYgKG1lc2gpIHJlc29sdmUobWVzaClcbiAgICAgIHRoaXMuZWwuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgICAgJ2ltYWdlLWxvYWRlZCcsXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICByZXNvbHZlKHRoaXMuZWwub2JqZWN0M0RNYXAubWVzaClcbiAgICAgICAgfSxcbiAgICAgICAgeyBvbmNlOiB0cnVlIH1cbiAgICAgIClcbiAgICB9KVxuICB9LFxufSlcbiIsIi8vIFBhcmFsbGF4IE9jY2x1c2lvbiBzaGFkZXJzIGZyb21cbi8vICAgIGh0dHA6Ly9zdW5hbmRibGFja2NhdC5jb20vdGlwRnVsbFZpZXcucGhwP3RvcGljaWQ9Mjhcbi8vIE5vIHRhbmdlbnQtc3BhY2UgdHJhbnNmb3JtcyBsb2dpYyBiYXNlZCBvblxuLy8gICBodHRwOi8vbW1pa2tlbHNlbjNkLmJsb2dzcG90LnNrLzIwMTIvMDIvcGFyYWxsYXhwb2MtbWFwcGluZy1hbmQtbm8tdGFuZ2VudC5odG1sXG5cbi8vIElkZW50aXR5IGZ1bmN0aW9uIGZvciBnbHNsLWxpdGVyYWwgaGlnaGxpZ2h0aW5nIGluIFZTIENvZGVcbmNvbnN0IGdsc2wgPSBTdHJpbmcucmF3XG5cbmNvbnN0IFBhcmFsbGF4U2hhZGVyID0ge1xuICAvLyBPcmRlcmVkIGZyb20gZmFzdGVzdCB0byBiZXN0IHF1YWxpdHkuXG4gIG1vZGVzOiB7XG4gICAgbm9uZTogJ05PX1BBUkFMTEFYJyxcbiAgICBiYXNpYzogJ1VTRV9CQVNJQ19QQVJBTExBWCcsXG4gICAgc3RlZXA6ICdVU0VfU1RFRVBfUEFSQUxMQVgnLFxuICAgIG9jY2x1c2lvbjogJ1VTRV9PQ0xVU0lPTl9QQVJBTExBWCcsIC8vIGEuay5hLiBQT01cbiAgICByZWxpZWY6ICdVU0VfUkVMSUVGX1BBUkFMTEFYJyxcbiAgfSxcblxuICB1bmlmb3Jtczoge1xuICAgIGJ1bXBNYXA6IHsgdmFsdWU6IG51bGwgfSxcbiAgICBtYXA6IHsgdmFsdWU6IG51bGwgfSxcbiAgICBwYXJhbGxheFNjYWxlOiB7IHZhbHVlOiBudWxsIH0sXG4gICAgcGFyYWxsYXhNaW5MYXllcnM6IHsgdmFsdWU6IG51bGwgfSxcbiAgICBwYXJhbGxheE1heExheWVyczogeyB2YWx1ZTogbnVsbCB9LFxuICB9LFxuXG4gIHZlcnRleFNoYWRlcjogZ2xzbGBcbiAgICB2YXJ5aW5nIHZlYzIgdlV2O1xuICAgIHZhcnlpbmcgdmVjMyB2Vmlld1Bvc2l0aW9uO1xuICAgIHZhcnlpbmcgdmVjMyB2Tm9ybWFsO1xuXG4gICAgdm9pZCBtYWluKCkge1xuICAgICAgdlV2ID0gdXY7XG4gICAgICB2ZWM0IG12UG9zaXRpb24gPSBtb2RlbFZpZXdNYXRyaXggKiB2ZWM0KCBwb3NpdGlvbiwgMS4wICk7XG4gICAgICB2Vmlld1Bvc2l0aW9uID0gLW12UG9zaXRpb24ueHl6O1xuICAgICAgdk5vcm1hbCA9IG5vcm1hbGl6ZSggbm9ybWFsTWF0cml4ICogbm9ybWFsICk7XG4gICAgICBcbiAgICAgIGdsX1Bvc2l0aW9uID0gcHJvamVjdGlvbk1hdHJpeCAqIG12UG9zaXRpb247XG4gICAgfVxuICBgLFxuXG4gIGZyYWdtZW50U2hhZGVyOiBnbHNsYFxuICAgIHVuaWZvcm0gc2FtcGxlcjJEIGJ1bXBNYXA7XG4gICAgdW5pZm9ybSBzYW1wbGVyMkQgbWFwO1xuXG4gICAgdW5pZm9ybSBmbG9hdCBwYXJhbGxheFNjYWxlO1xuICAgIHVuaWZvcm0gZmxvYXQgcGFyYWxsYXhNaW5MYXllcnM7XG4gICAgdW5pZm9ybSBmbG9hdCBwYXJhbGxheE1heExheWVycztcbiAgICB1bmlmb3JtIGZsb2F0IGZhZGU7IC8vIENVU1RPTVxuXG4gICAgdmFyeWluZyB2ZWMyIHZVdjtcbiAgICB2YXJ5aW5nIHZlYzMgdlZpZXdQb3NpdGlvbjtcbiAgICB2YXJ5aW5nIHZlYzMgdk5vcm1hbDtcblxuICAgICNpZmRlZiBVU0VfQkFTSUNfUEFSQUxMQVhcblxuICAgIHZlYzIgcGFyYWxsYXhNYXAoaW4gdmVjMyBWKSB7XG4gICAgICBmbG9hdCBpbml0aWFsSGVpZ2h0ID0gdGV4dHVyZTJEKGJ1bXBNYXAsIHZVdikucjtcblxuICAgICAgLy8gTm8gT2Zmc2V0IExpbWl0dGluZzogbWVzc3ksIGZsb2F0aW5nIG91dHB1dCBhdCBncmF6aW5nIGFuZ2xlcy5cbiAgICAgIC8vXCJ2ZWMyIHRleENvb3JkT2Zmc2V0ID0gcGFyYWxsYXhTY2FsZSAqIFYueHkgLyBWLnogKiBpbml0aWFsSGVpZ2h0O1wiLFxuXG4gICAgICAvLyBPZmZzZXQgTGltaXRpbmdcbiAgICAgIHZlYzIgdGV4Q29vcmRPZmZzZXQgPSBwYXJhbGxheFNjYWxlICogVi54eSAqIGluaXRpYWxIZWlnaHQ7XG4gICAgICByZXR1cm4gdlV2IC0gdGV4Q29vcmRPZmZzZXQ7XG4gICAgfVxuXG4gICAgI2Vsc2VcblxuICAgIHZlYzIgcGFyYWxsYXhNYXAoaW4gdmVjMyBWKSB7XG4gICAgICAvLyBEZXRlcm1pbmUgbnVtYmVyIG9mIGxheWVycyBmcm9tIGFuZ2xlIGJldHdlZW4gViBhbmQgTlxuICAgICAgZmxvYXQgbnVtTGF5ZXJzID0gbWl4KHBhcmFsbGF4TWF4TGF5ZXJzLCBwYXJhbGxheE1pbkxheWVycywgYWJzKGRvdCh2ZWMzKDAuMCwgMC4wLCAxLjApLCBWKSkpO1xuXG4gICAgICBmbG9hdCBsYXllckhlaWdodCA9IDEuMCAvIG51bUxheWVycztcbiAgICAgIGZsb2F0IGN1cnJlbnRMYXllckhlaWdodCA9IDAuMDtcbiAgICAgIC8vIFNoaWZ0IG9mIHRleHR1cmUgY29vcmRpbmF0ZXMgZm9yIGVhY2ggaXRlcmF0aW9uXG4gICAgICB2ZWMyIGR0ZXggPSBwYXJhbGxheFNjYWxlICogVi54eSAvIFYueiAvIG51bUxheWVycztcblxuICAgICAgdmVjMiBjdXJyZW50VGV4dHVyZUNvb3JkcyA9IHZVdjtcblxuICAgICAgZmxvYXQgaGVpZ2h0RnJvbVRleHR1cmUgPSB0ZXh0dXJlMkQoYnVtcE1hcCwgY3VycmVudFRleHR1cmVDb29yZHMpLnI7XG5cbiAgICAgIC8vIHdoaWxlICggaGVpZ2h0RnJvbVRleHR1cmUgPiBjdXJyZW50TGF5ZXJIZWlnaHQgKVxuICAgICAgLy8gSW5maW5pdGUgbG9vcHMgYXJlIG5vdCB3ZWxsIHN1cHBvcnRlZC4gRG8gYSBcImxhcmdlXCIgZmluaXRlXG4gICAgICAvLyBsb29wLCBidXQgbm90IHRvbyBsYXJnZSwgYXMgaXQgc2xvd3MgZG93biBzb21lIGNvbXBpbGVycy5cbiAgICAgIGZvciAoaW50IGkgPSAwOyBpIDwgMzA7IGkgKz0gMSkge1xuICAgICAgICBpZiAoaGVpZ2h0RnJvbVRleHR1cmUgPD0gY3VycmVudExheWVySGVpZ2h0KSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY3VycmVudExheWVySGVpZ2h0ICs9IGxheWVySGVpZ2h0O1xuICAgICAgICAvLyBTaGlmdCB0ZXh0dXJlIGNvb3JkaW5hdGVzIGFsb25nIHZlY3RvciBWXG4gICAgICAgIGN1cnJlbnRUZXh0dXJlQ29vcmRzIC09IGR0ZXg7XG4gICAgICAgIGhlaWdodEZyb21UZXh0dXJlID0gdGV4dHVyZTJEKGJ1bXBNYXAsIGN1cnJlbnRUZXh0dXJlQ29vcmRzKS5yO1xuICAgICAgfVxuXG4gICAgICAjaWZkZWYgVVNFX1NURUVQX1BBUkFMTEFYXG5cbiAgICAgIHJldHVybiBjdXJyZW50VGV4dHVyZUNvb3JkcztcblxuICAgICAgI2VsaWYgZGVmaW5lZChVU0VfUkVMSUVGX1BBUkFMTEFYKVxuXG4gICAgICB2ZWMyIGRlbHRhVGV4Q29vcmQgPSBkdGV4IC8gMi4wO1xuICAgICAgZmxvYXQgZGVsdGFIZWlnaHQgPSBsYXllckhlaWdodCAvIDIuMDtcblxuICAgICAgLy8gUmV0dXJuIHRvIHRoZSBtaWQgcG9pbnQgb2YgcHJldmlvdXMgbGF5ZXJcbiAgICAgIGN1cnJlbnRUZXh0dXJlQ29vcmRzICs9IGRlbHRhVGV4Q29vcmQ7XG4gICAgICBjdXJyZW50TGF5ZXJIZWlnaHQgLT0gZGVsdGFIZWlnaHQ7XG5cbiAgICAgIC8vIEJpbmFyeSBzZWFyY2ggdG8gaW5jcmVhc2UgcHJlY2lzaW9uIG9mIFN0ZWVwIFBhcmFsbGF4IE1hcHBpbmdcbiAgICAgIGNvbnN0IGludCBudW1TZWFyY2hlcyA9IDU7XG4gICAgICBmb3IgKGludCBpID0gMDsgaSA8IG51bVNlYXJjaGVzOyBpICs9IDEpIHtcbiAgICAgICAgZGVsdGFUZXhDb29yZCAvPSAyLjA7XG4gICAgICAgIGRlbHRhSGVpZ2h0IC89IDIuMDtcbiAgICAgICAgaGVpZ2h0RnJvbVRleHR1cmUgPSB0ZXh0dXJlMkQoYnVtcE1hcCwgY3VycmVudFRleHR1cmVDb29yZHMpLnI7XG4gICAgICAgIC8vIFNoaWZ0IGFsb25nIG9yIGFnYWluc3QgdmVjdG9yIFZcbiAgICAgICAgaWYgKGhlaWdodEZyb21UZXh0dXJlID4gY3VycmVudExheWVySGVpZ2h0KSB7XG4gICAgICAgICAgLy8gQmVsb3cgdGhlIHN1cmZhY2VcblxuICAgICAgICAgIGN1cnJlbnRUZXh0dXJlQ29vcmRzIC09IGRlbHRhVGV4Q29vcmQ7XG4gICAgICAgICAgY3VycmVudExheWVySGVpZ2h0ICs9IGRlbHRhSGVpZ2h0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGFib3ZlIHRoZSBzdXJmYWNlXG5cbiAgICAgICAgICBjdXJyZW50VGV4dHVyZUNvb3JkcyArPSBkZWx0YVRleENvb3JkO1xuICAgICAgICAgIGN1cnJlbnRMYXllckhlaWdodCAtPSBkZWx0YUhlaWdodDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGN1cnJlbnRUZXh0dXJlQ29vcmRzO1xuXG4gICAgICAjZWxpZiBkZWZpbmVkKFVTRV9PQ0xVU0lPTl9QQVJBTExBWClcblxuICAgICAgdmVjMiBwcmV2VENvb3JkcyA9IGN1cnJlbnRUZXh0dXJlQ29vcmRzICsgZHRleDtcblxuICAgICAgLy8gSGVpZ2h0cyBmb3IgbGluZWFyIGludGVycG9sYXRpb25cbiAgICAgIGZsb2F0IG5leHRIID0gaGVpZ2h0RnJvbVRleHR1cmUgLSBjdXJyZW50TGF5ZXJIZWlnaHQ7XG4gICAgICBmbG9hdCBwcmV2SCA9IHRleHR1cmUyRChidW1wTWFwLCBwcmV2VENvb3JkcykuciAtIGN1cnJlbnRMYXllckhlaWdodCArIGxheWVySGVpZ2h0O1xuXG4gICAgICAvLyBQcm9wb3J0aW9ucyBmb3IgbGluZWFyIGludGVycG9sYXRpb25cbiAgICAgIGZsb2F0IHdlaWdodCA9IG5leHRIIC8gKG5leHRIIC0gcHJldkgpO1xuXG4gICAgICAvLyBJbnRlcnBvbGF0aW9uIG9mIHRleHR1cmUgY29vcmRpbmF0ZXNcbiAgICAgIHJldHVybiBwcmV2VENvb3JkcyAqIHdlaWdodCArIGN1cnJlbnRUZXh0dXJlQ29vcmRzICogKDEuMCAtIHdlaWdodCk7XG5cbiAgICAgICNlbHNlIC8vIE5PX1BBUkFMTEFYXG5cbiAgICAgIHJldHVybiB2VXY7XG5cbiAgICAgICNlbmRpZlxuICAgIH1cbiAgICAjZW5kaWZcblxuICAgIHZlYzIgcGVydHVyYlV2KHZlYzMgc3VyZlBvc2l0aW9uLCB2ZWMzIHN1cmZOb3JtYWwsIHZlYzMgdmlld1Bvc2l0aW9uKSB7XG4gICAgICB2ZWMyIHRleER4ID0gZEZkeCh2VXYpO1xuICAgICAgdmVjMiB0ZXhEeSA9IGRGZHkodlV2KTtcblxuICAgICAgdmVjMyB2U2lnbWFYID0gZEZkeChzdXJmUG9zaXRpb24pO1xuICAgICAgdmVjMyB2U2lnbWFZID0gZEZkeShzdXJmUG9zaXRpb24pO1xuICAgICAgdmVjMyB2UjEgPSBjcm9zcyh2U2lnbWFZLCBzdXJmTm9ybWFsKTtcbiAgICAgIHZlYzMgdlIyID0gY3Jvc3Moc3VyZk5vcm1hbCwgdlNpZ21hWCk7XG4gICAgICBmbG9hdCBmRGV0ID0gZG90KHZTaWdtYVgsIHZSMSk7XG5cbiAgICAgIHZlYzIgdlByb2pWc2NyID0gKDEuMCAvIGZEZXQpICogdmVjMihkb3QodlIxLCB2aWV3UG9zaXRpb24pLCBkb3QodlIyLCB2aWV3UG9zaXRpb24pKTtcbiAgICAgIHZlYzMgdlByb2pWdGV4O1xuICAgICAgdlByb2pWdGV4Lnh5ID0gdGV4RHggKiB2UHJvalZzY3IueCArIHRleER5ICogdlByb2pWc2NyLnk7XG4gICAgICB2UHJvalZ0ZXgueiA9IGRvdChzdXJmTm9ybWFsLCB2aWV3UG9zaXRpb24pO1xuXG4gICAgICByZXR1cm4gcGFyYWxsYXhNYXAodlByb2pWdGV4KTtcbiAgICB9XG5cbiAgICB2b2lkIG1haW4oKSB7XG4gICAgICB2ZWMyIG1hcFV2ID0gcGVydHVyYlV2KC12Vmlld1Bvc2l0aW9uLCBub3JtYWxpemUodk5vcm1hbCksIG5vcm1hbGl6ZSh2Vmlld1Bvc2l0aW9uKSk7XG4gICAgICBcbiAgICAgIC8vIENVU1RPTSBTVEFSVFxuICAgICAgdmVjNCB0ZXhlbCA9IHRleHR1cmUyRChtYXAsIG1hcFV2KTtcbiAgICAgIHZlYzMgY29sb3IgPSBtaXgodGV4ZWwueHl6LCB2ZWMzKDApLCBmYWRlKTtcbiAgICAgIGdsX0ZyYWdDb2xvciA9IHZlYzQoY29sb3IsIDEuMCk7XG4gICAgICAvLyBDVVNUT00gRU5EXG4gICAgfVxuXG4gIGAsXG59XG5cbmV4cG9ydCB7IFBhcmFsbGF4U2hhZGVyIH1cbiIsIi8qKlxuICogRGVzY3JpcHRpb25cbiAqID09PT09PT09PT09XG4gKiBDcmVhdGUgdGhlIGlsbHVzaW9uIG9mIGRlcHRoIGluIGEgY29sb3IgaW1hZ2UgZnJvbSBhIGRlcHRoIG1hcFxuICpcbiAqIFVzYWdlXG4gKiA9PT09PVxuICogQ3JlYXRlIGEgcGxhbmUgaW4gQmxlbmRlciBhbmQgZ2l2ZSBpdCBhIG1hdGVyaWFsIChqdXN0IHRoZSBkZWZhdWx0IFByaW5jaXBsZWQgQlNERikuXG4gKiBBc3NpZ24gY29sb3IgaW1hZ2UgdG8gXCJjb2xvclwiIGNoYW5uZWwgYW5kIGRlcHRoIG1hcCB0byBcImVtaXNzaXZlXCIgY2hhbm5lbC5cbiAqIFlvdSBtYXkgd2FudCB0byBzZXQgZW1pc3NpdmUgc3RyZW5ndGggdG8gemVybyBzbyB0aGUgcHJldmlldyBsb29rcyBiZXR0ZXIuXG4gKiBBZGQgdGhlIFwicGFyYWxsYXhcIiBjb21wb25lbnQgZnJvbSB0aGUgSHVicyBleHRlbnNpb24sIGNvbmZpZ3VyZSwgYW5kIGV4cG9ydCBhcyAuZ2xiXG4gKi9cblxuaW1wb3J0IHsgUGFyYWxsYXhTaGFkZXIgfSBmcm9tICcuLi9zaGFkZXJzL3BhcmFsbGF4LXNoYWRlci5qcydcblxuY29uc3QgdmVjID0gbmV3IFRIUkVFLlZlY3RvcjMoKVxuY29uc3QgZm9yd2FyZCA9IG5ldyBUSFJFRS5WZWN0b3IzKDAsIDAsIDEpXG5cbkFGUkFNRS5yZWdpc3RlckNvbXBvbmVudCgncGFyYWxsYXgnLCB7XG4gIHNjaGVtYToge1xuICAgIHN0cmVuZ3RoOiB7IHR5cGU6ICdudW1iZXInLCBkZWZhdWx0OiAwLjUgfSxcbiAgICBjdXRvZmZUcmFuc2l0aW9uOiB7IHR5cGU6ICdudW1iZXInLCBkZWZhdWx0OiBNYXRoLlBJIC8gOCB9LFxuICAgIGN1dG9mZkFuZ2xlOiB7IHR5cGU6ICdudW1iZXInLCBkZWZhdWx0OiBNYXRoLlBJIC8gNCB9LFxuICB9LFxuICBpbml0OiBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3QgbWVzaCA9IHRoaXMuZWwub2JqZWN0M0RNYXAubWVzaFxuICAgIGNvbnN0IHsgbWFwOiBjb2xvck1hcCwgZW1pc3NpdmVNYXA6IGRlcHRoTWFwIH0gPSBtZXNoLm1hdGVyaWFsXG4gICAgY29sb3JNYXAud3JhcFMgPSBjb2xvck1hcC53cmFwVCA9IFRIUkVFLkNsYW1wVG9FZGdlV3JhcHBpbmdcbiAgICBkZXB0aE1hcC53cmFwUyA9IGRlcHRoTWFwLndyYXBUID0gVEhSRUUuQ2xhbXBUb0VkZ2VXcmFwcGluZ1xuICAgIGNvbnN0IHsgdmVydGV4U2hhZGVyLCBmcmFnbWVudFNoYWRlciB9ID0gUGFyYWxsYXhTaGFkZXJcbiAgICB0aGlzLm1hdGVyaWFsID0gbmV3IFRIUkVFLlNoYWRlck1hdGVyaWFsKHtcbiAgICAgIHZlcnRleFNoYWRlcixcbiAgICAgIGZyYWdtZW50U2hhZGVyLFxuICAgICAgZGVmaW5lczogeyBVU0VfT0NMVVNJT05fUEFSQUxMQVg6IHRydWUgfSxcbiAgICAgIHVuaWZvcm1zOiB7XG4gICAgICAgIG1hcDogeyB2YWx1ZTogY29sb3JNYXAgfSxcbiAgICAgICAgYnVtcE1hcDogeyB2YWx1ZTogZGVwdGhNYXAgfSxcbiAgICAgICAgcGFyYWxsYXhTY2FsZTogeyB2YWx1ZTogLTEgKiB0aGlzLmRhdGEuc3RyZW5ndGggfSxcbiAgICAgICAgcGFyYWxsYXhNaW5MYXllcnM6IHsgdmFsdWU6IDIwIH0sXG4gICAgICAgIHBhcmFsbGF4TWF4TGF5ZXJzOiB7IHZhbHVlOiAzMCB9LFxuICAgICAgICBmYWRlOiB7IHZhbHVlOiAwIH0sXG4gICAgICB9LFxuICAgIH0pXG4gICAgbWVzaC5tYXRlcmlhbCA9IHRoaXMubWF0ZXJpYWxcbiAgfSxcbiAgdGljaygpIHtcbiAgICBpZiAodGhpcy5lbC5zY2VuZUVsLmNhbWVyYSkge1xuICAgICAgdGhpcy5lbC5zY2VuZUVsLmNhbWVyYS5nZXRXb3JsZFBvc2l0aW9uKHZlYylcbiAgICAgIHRoaXMuZWwub2JqZWN0M0Qud29ybGRUb0xvY2FsKHZlYylcbiAgICAgIGNvbnN0IGFuZ2xlID0gdmVjLmFuZ2xlVG8oZm9yd2FyZClcbiAgICAgIGNvbnN0IGZhZGUgPSBtYXBMaW5lYXJDbGFtcGVkKFxuICAgICAgICBhbmdsZSxcbiAgICAgICAgdGhpcy5kYXRhLmN1dG9mZkFuZ2xlIC0gdGhpcy5kYXRhLmN1dG9mZlRyYW5zaXRpb24sXG4gICAgICAgIHRoaXMuZGF0YS5jdXRvZmZBbmdsZSArIHRoaXMuZGF0YS5jdXRvZmZUcmFuc2l0aW9uLFxuICAgICAgICAwLCAvLyBJbiB2aWV3IHpvbmUsIG5vIGZhZGVcbiAgICAgICAgMSAvLyBPdXRzaWRlIHZpZXcgem9uZSwgZnVsbCBmYWRlXG4gICAgICApXG4gICAgICB0aGlzLm1hdGVyaWFsLnVuaWZvcm1zLmZhZGUudmFsdWUgPSBmYWRlXG4gICAgfVxuICB9LFxufSlcblxuZnVuY3Rpb24gY2xhbXAodmFsdWUsIG1pbiwgbWF4KSB7XG4gIHJldHVybiBNYXRoLm1heChtaW4sIE1hdGgubWluKG1heCwgdmFsdWUpKVxufVxuXG5mdW5jdGlvbiBtYXBMaW5lYXIoeCwgYTEsIGEyLCBiMSwgYjIpIHtcbiAgcmV0dXJuIGIxICsgKCh4IC0gYTEpICogKGIyIC0gYjEpKSAvIChhMiAtIGExKVxufVxuXG5mdW5jdGlvbiBtYXBMaW5lYXJDbGFtcGVkKHgsIGExLCBhMiwgYjEsIGIyKSB7XG4gIHJldHVybiBjbGFtcChtYXBMaW5lYXIoeCwgYTEsIGEyLCBiMSwgYjIpLCBiMSwgYjIpXG59XG4iLCIvKipcbiAqIERlc2NyaXB0aW9uXG4gKiA9PT09PT09PT09PVxuICogY3JlYXRlIGEgSFRNTCBvYmplY3QgYnkgcmVuZGVyaW5nIGEgc2NyaXB0IHRoYXQgY3JlYXRlcyBhbmQgbWFuYWdlcyBpdFxuICpcbiAqL1xuXG5pbXBvcnQgKiBhcyBodG1sQ29tcG9uZW50cyBmcm9tIFwiaHR0cHM6Ly9yZXNvdXJjZXMucmVhbGl0eW1lZGlhLmRpZ2l0YWwvdnVlLWFwcHMvZGlzdC9odWJzLmpzXCI7XG5cbi8vIHZhciBodG1sQ29tcG9uZW50cztcbi8vIHZhciBzY3JpcHRQcm9taXNlO1xuLy8gaWYgKHdpbmRvdy5fX3Rlc3RpbmdWdWVBcHBzKSB7XG4vLyAgICAgc2NyaXB0UHJvbWlzZSA9IGltcG9ydCh3aW5kb3cuX190ZXN0aW5nVnVlQXBwcykgICAgXG4vLyB9IGVsc2Uge1xuLy8gICAgIHNjcmlwdFByb21pc2UgPSBpbXBvcnQoXCJodHRwczovL3Jlc291cmNlcy5yZWFsaXR5bWVkaWEuZGlnaXRhbC92dWUtYXBwcy9kaXN0L2h1YnMuanNcIikgXG4vLyB9XG4vLyAvLyBzY3JpcHRQcm9taXNlID0gc2NyaXB0UHJvbWlzZS50aGVuKG1vZHVsZSA9PiB7XG4vLyAvLyAgICAgcmV0dXJuIG1vZHVsZVxuLy8gLy8gfSk7XG4vKipcbiAqIE1vZGlmaWVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvaHVicy9ibG9iL21hc3Rlci9zcmMvY29tcG9uZW50cy9mYWRlci5qc1xuICogdG8gaW5jbHVkZSBhZGp1c3RhYmxlIGR1cmF0aW9uIGFuZCBjb252ZXJ0ZWQgZnJvbSBjb21wb25lbnQgdG8gc3lzdGVtXG4gKi9cblxuIEFGUkFNRS5yZWdpc3RlclN5c3RlbSgnaHRtbC1zY3JpcHQnLCB7ICBcbiAgICBpbml0KCkge1xuICAgICAgICB0aGlzLnN5c3RlbVRpY2sgPSBodG1sQ29tcG9uZW50c1tcInN5c3RlbVRpY2tcIl07XG4gICAgICAgIHRoaXMuaW5pdGlhbGl6ZUV0aGVyZWFsID0gaHRtbENvbXBvbmVudHNbXCJpbml0aWFsaXplRXRoZXJlYWxcIl1cbiAgICAgICAgaWYgKCF0aGlzLnN5c3RlbVRpY2sgfHwgIXRoaXMuaW5pdGlhbGl6ZUV0aGVyZWFsKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiZXJyb3IgaW4gaHRtbC1zY3JpcHQgc3lzdGVtOiBodG1sQ29tcG9uZW50cyBoYXMgbm8gc3lzdGVtVGljayBhbmQvb3IgaW5pdGlhbGl6ZUV0aGVyZWFsIG1ldGhvZHNcIilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUV0aGVyZWFsKClcbiAgICAgICAgfVxuICAgIH0sXG4gIFxuICAgIHRpY2sodCwgZHQpIHtcbiAgICAgICAgdGhpcy5zeXN0ZW1UaWNrKHQsIGR0KVxuICAgIH0sXG4gIH0pXG4gIFxuXG5BRlJBTUUucmVnaXN0ZXJDb21wb25lbnQoJ2h0bWwtc2NyaXB0Jywge1xuICAgIHNjaGVtYToge1xuICAgICAgICAvLyBuYW1lIG11c3QgZm9sbG93IHRoZSBwYXR0ZXJuIFwiKl9jb21wb25lbnROYW1lXCJcbiAgICAgICAgbmFtZTogeyB0eXBlOiBcInN0cmluZ1wiLCBkZWZhdWx0OiBcIlwifVxuICAgIH0sXG4gICAgaW5pdDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnNjcmlwdCA9IG51bGw7XG4gICAgICAgIHRoaXMuZnVsbE5hbWUgPSB0aGlzLmRhdGEubmFtZTtcbiAgICAgICAgdGhpcy5wYXJzZU5vZGVOYW1lKCk7XG4gICAgICAgIHRoaXMuY3JlYXRlU2NyaXB0KCk7XG4gICAgfSxcblxuICAgIHVwZGF0ZTogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5kYXRhLm5hbWUgPT09IFwiXCIgfHwgdGhpcy5kYXRhLm5hbWUgPT09IHRoaXMuZnVsbE5hbWUpIHJldHVyblxuXG4gICAgICAgIHRoaXMuZnVsbE5hbWUgPSB0aGlzLmRhdGEubmFtZTtcbiAgICAgICAgdGhpcy5wYXJzZU5vZGVOYW1lKCk7XG5cbiAgICAgICAgaWYgKHRoaXMuc2NyaXB0KSB7XG4gICAgICAgICAgICB0aGlzLmRlc3Ryb3lTY3JpcHQoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuY3JlYXRlU2NyaXB0KCk7XG4gICAgfSxcblxuICAgIGNyZWF0ZVNjcmlwdDogZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBlYWNoIHRpbWUgd2UgbG9hZCBhIHNjcmlwdCBjb21wb25lbnQgd2Ugd2lsbCBwb3NzaWJseSBjcmVhdGVcbiAgICAgICAgLy8gYSBuZXcgbmV0d29ya2VkIGNvbXBvbmVudC4gIFRoaXMgaXMgZmluZSwgc2luY2UgdGhlIG5ldHdvcmtlZCBJZCBcbiAgICAgICAgLy8gaXMgYmFzZWQgb24gdGhlIGZ1bGwgbmFtZSBwYXNzZWQgYXMgYSBwYXJhbWV0ZXIsIG9yIGFzc2lnbmVkIHRvIHRoZVxuICAgICAgICAvLyBjb21wb25lbnQgaW4gU3Bva2UuICBJdCBkb2VzIG1lYW4gdGhhdCBpZiB3ZSBoYXZlXG4gICAgICAgIC8vIG11bHRpcGxlIG9iamVjdHMgaW4gdGhlIHNjZW5lIHdoaWNoIGhhdmUgdGhlIHNhbWUgbmFtZSwgdGhleSB3aWxsXG4gICAgICAgIC8vIGJlIGluIHN5bmMuICBJdCBhbHNvIG1lYW5zIHRoYXQgaWYgeW91IHdhbnQgdG8gZHJvcCBhIGNvbXBvbmVudCBvblxuICAgICAgICAvLyB0aGUgc2NlbmUgdmlhIGEgLmdsYiwgaXQgbXVzdCBoYXZlIGEgdmFsaWQgbmFtZSBwYXJhbWV0ZXIgaW5zaWRlIGl0LlxuICAgICAgICAvLyBBIC5nbGIgaW4gc3Bva2Ugd2lsbCBmYWxsIGJhY2sgdG8gdGhlIHNwb2tlIG5hbWUgaWYgeW91IHVzZSBvbmUgd2l0aG91dFxuICAgICAgICAvLyBhIG5hbWUgaW5zaWRlIGl0LlxuICAgICAgICB0aGlzLmxvYWRTY3JpcHQoKS50aGVuKCAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuc2NyaXB0KSByZXR1cm5cblxuICAgICAgICAgICAgaWYgKHRoaXMuc2NyaXB0LmlzTmV0d29ya2VkKSB7XG4gICAgICAgICAgICAgICAgLy8gZ2V0IHRoZSBwYXJlbnQgbmV0d29ya2VkIGVudGl0eSwgd2hlbiBpdCdzIGZpbmlzaGVkIGluaXRpYWxpemluZy4gIFxuICAgICAgICAgICAgICAgIC8vIFdoZW4gY3JlYXRpbmcgdGhpcyBhcyBwYXJ0IG9mIGEgR0xURiBsb2FkLCB0aGUgXG4gICAgICAgICAgICAgICAgLy8gcGFyZW50IGEgZmV3IHN0ZXBzIHVwIHdpbGwgYmUgbmV0d29ya2VkLiAgV2UnbGwgb25seSBkbyB0aGlzXG4gICAgICAgICAgICAgICAgLy8gaWYgdGhlIEhUTUwgc2NyaXB0IHdhbnRzIHRvIGJlIG5ldHdvcmtlZFxuICAgICAgICAgICAgICAgIHRoaXMubmV0RW50aXR5ID0gbnVsbFxuXG4gICAgICAgICAgICAgICAgLy8gYmluZCBjYWxsYmFja3NcbiAgICAgICAgICAgICAgICB0aGlzLmdldFNoYXJlZERhdGEgPSB0aGlzLmdldFNoYXJlZERhdGEuYmluZCh0aGlzKTtcbiAgICAgICAgICAgICAgICB0aGlzLnRha2VPd25lcnNoaXAgPSB0aGlzLnRha2VPd25lcnNoaXAuYmluZCh0aGlzKTtcbiAgICAgICAgICAgICAgICB0aGlzLnNldFNoYXJlZERhdGEgPSB0aGlzLnNldFNoYXJlZERhdGEuYmluZCh0aGlzKVxuXG4gICAgICAgICAgICAgICAgdGhpcy5zY3JpcHQuc2V0TmV0d29ya01ldGhvZHModGhpcy50YWtlT3duZXJzaGlwLCB0aGlzLnNldFNoYXJlZERhdGEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIHNldCB1cCB0aGUgbG9jYWwgY29udGVudCBhbmQgaG9vayBpdCB0byB0aGUgc2NlbmVcbiAgICAgICAgICAgIGNvbnN0IHNjcmlwdEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYS1lbnRpdHknKVxuICAgICAgICAgICAgdGhpcy5zaW1wbGVDb250YWluZXIgPSBzY3JpcHRFbFxuICAgICAgICAgICAgdGhpcy5zaW1wbGVDb250YWluZXIub2JqZWN0M0QubWF0cml4QXV0b1VwZGF0ZSA9IHRydWVcbiAgICAgICAgICAgIHRoaXMuc2ltcGxlQ29udGFpbmVyLnNldE9iamVjdDNEKFwid2VibGF5ZXIzZFwiLCB0aGlzLnNjcmlwdC53ZWJMYXllcjNEKVxuXG4gICAgICAgICAgICAvLyBsZXRzIGZpZ3VyZSBvdXQgdGhlIHNjYWxlLCBidXQgc2NhbGluZyB0byBmaWxsIHRoZSBhIDF4MW0gc3F1YXJlLCB0aGF0IGhhcyBhbHNvXG4gICAgICAgICAgICAvLyBwb3RlbnRpYWxseSBiZWVuIHNjYWxlZCBieSB0aGUgcGFyZW50cyBwYXJlbnQgbm9kZS4gSWYgd2Ugc2NhbGUgdGhlIGVudGl0eSBpbiBzcG9rZSxcbiAgICAgICAgICAgIC8vIHRoaXMgaXMgd2hlcmUgdGhlIHNjYWxlIGlzIHNldC4gIElmIHdlIGRyb3AgYSBub2RlIGluIGFuZCBzY2FsZSBpdCwgdGhlIHNjYWxlIGlzIGFsc29cbiAgICAgICAgICAgIC8vIHNldCB0aGVyZS5cbiAgICAgICAgICAgIC8vIFdlIHVzZWQgdG8gaGF2ZSBhIGZpeGVkIHNpemUgcGFzc2VkIGJhY2sgZnJvbSB0aGUgZW50aXR5LCBidXQgdGhhdCdzIHRvbyByZXN0cmljdGl2ZTpcbiAgICAgICAgICAgIC8vIGNvbnN0IHdpZHRoID0gdGhpcy5zY3JpcHQud2lkdGhcbiAgICAgICAgICAgIC8vIGNvbnN0IGhlaWdodCA9IHRoaXMuc2NyaXB0LmhlaWdodFxuXG4gICAgICAgICAgICB2YXIgcGFyZW50MiA9IHRoaXMuZWwucGFyZW50RWwucGFyZW50RWwub2JqZWN0M0RcbiAgICAgICAgICAgIHZhciB3aWR0aCA9IHBhcmVudDIuc2NhbGUueFxuICAgICAgICAgICAgdmFyIGhlaWdodCA9IHBhcmVudDIuc2NhbGUueVxuICAgICAgICAgICAgcGFyZW50Mi5zY2FsZS54ID0gMVxuICAgICAgICAgICAgcGFyZW50Mi5zY2FsZS55ID0gMVxuICAgICAgICAgICAgcGFyZW50Mi5zY2FsZS56ID0gMVxuXG4gICAgICAgICAgICBpZiAod2lkdGggJiYgd2lkdGggPiAwICYmIGhlaWdodCAmJiBoZWlnaHQgPiAwKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qge3dpZHRoOiB3c2l6ZSwgaGVpZ2h0OiBoc2l6ZX0gPSB0aGlzLnNjcmlwdC5nZXRTaXplKClcbiAgICAgICAgICAgICAgICB2YXIgc2NhbGUgPSBNYXRoLm1pbih3aWR0aCAvIHdzaXplLCBoZWlnaHQgLyBoc2l6ZSlcbiAgICAgICAgICAgICAgICB0aGlzLnNpbXBsZUNvbnRhaW5lci5zZXRBdHRyaWJ1dGUoXCJzY2FsZVwiLCB7IHg6IHNjYWxlLCB5OiBzY2FsZSwgejogc2NhbGV9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gdGhlcmUgd2lsbCBiZSBvbmUgZWxlbWVudCBhbHJlYWR5LCB0aGUgY3ViZSB3ZSBjcmVhdGVkIGluIGJsZW5kZXJcbiAgICAgICAgICAgIC8vIGFuZCBhdHRhY2hlZCB0aGlzIGNvbXBvbmVudCB0bywgc28gcmVtb3ZlIGl0IGlmIGl0IGlzIHRoZXJlLlxuICAgICAgICAgICAgLy8gdGhpcy5lbC5vYmplY3QzRC5jaGlsZHJlbi5wb3AoKVxuICAgICAgICAgICAgZm9yIChjb25zdCBjIG9mIHRoaXMuZWwub2JqZWN0M0QuY2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjLnZpc2libGUgPSBmYWxzZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbWFrZSBzdXJlIFwiaXNTdGF0aWNcIiBpcyBjb3JyZWN0OyAgY2FuJ3QgYmUgc3RhdGljIGlmIGVpdGhlciBpbnRlcmFjdGl2ZSBvciBuZXR3b3JrZWRcbiAgICAgICAgICAgIGlmICh0aGlzLnNjcmlwdC5pc1N0YXRpYyAmJiAodGhpcy5zY3JpcHQuaXNJbnRlcmFjdGl2ZSB8fCB0aGlzLnNjcmlwdC5pc05ldHdvcmtlZCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnNjcmlwdC5pc1N0YXRpYyA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBhZGQgaW4gb3VyIGNvbnRhaW5lclxuICAgICAgICAgICAgdGhpcy5lbC5hcHBlbmRDaGlsZCh0aGlzLnNpbXBsZUNvbnRhaW5lcilcblxuICAgICAgICAgICAgaWYgKHRoaXMuc2NyaXB0LmlzSW50ZXJhY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAvLyBtYWtlIHRoZSBodG1sIG9iamVjdCBjbGlja2FibGVcbiAgICAgICAgICAgICAgICB0aGlzLnNpbXBsZUNvbnRhaW5lci5zZXRBdHRyaWJ1dGUoJ2lzLXJlbW90ZS1ob3Zlci10YXJnZXQnLCcnKVxuICAgICAgICAgICAgICAgIHRoaXMuc2ltcGxlQ29udGFpbmVyLnNldEF0dHJpYnV0ZSgndGFncycsIHtzaW5nbGVBY3Rpb25CdXR0b246IHRydWV9KVxuICAgICAgICAgICAgICAgIHRoaXMuc2ltcGxlQ29udGFpbmVyLnNldEF0dHJpYnV0ZSgnY2xhc3MnLCBcImludGVyYWN0YWJsZVwiKVxuXG4gICAgICAgICAgICAgICAgLy8gZm9yd2FyZCB0aGUgJ2ludGVyYWN0JyBldmVudHMgdG8gb3VyIG9iamVjdCBcbiAgICAgICAgICAgICAgICB0aGlzLmNsaWNrZWQgPSB0aGlzLmNsaWNrZWQuYmluZCh0aGlzKVxuICAgICAgICAgICAgICAgIHRoaXMuc2ltcGxlQ29udGFpbmVyLm9iamVjdDNELmFkZEV2ZW50TGlzdGVuZXIoJ2ludGVyYWN0JywgdGhpcy5jbGlja2VkKVxuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuc2NyaXB0LmlzRHJhZ2dhYmxlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHdlIGFyZW4ndCBnb2luZyB0byByZWFsbHkgZGVhbCB3aXRoIHRoaXMgdGlsbCB3ZSBoYXZlIGEgdXNlIGNhc2UsIGJ1dFxuICAgICAgICAgICAgICAgICAgICAvLyB3ZSBjYW4gc2V0IGl0IHVwIGZvciBub3dcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zaW1wbGVDb250YWluZXIuc2V0QXR0cmlidXRlKCd0YWdzJywge3NpbmdsZUFjdGlvbkJ1dHRvbjogdHJ1ZSwgXG4gICAgICAgICAgICAgICAgICAgICAgICBpc0hvbGRhYmxlOiB0cnVlLCAgaG9sZGFibGVCdXR0b246IHRydWV9KVxuICAgIFxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNpbXBsZUNvbnRhaW5lci5vYmplY3QzRC5hZGRFdmVudExpc3RlbmVyKCdob2xkYWJsZS1idXR0b24tZG93bicsIChldnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2NyaXB0LmRyYWdTdGFydChldnQpXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2ltcGxlQ29udGFpbmVyLm9iamVjdDNELmFkZEV2ZW50TGlzdGVuZXIoJ2hvbGRhYmxlLWJ1dHRvbi11cCcsIChldnQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc2NyaXB0LmRyYWdFbmQoZXZ0KVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vdGhpcy5yYXljYXN0ZXIgPSBuZXcgVEhSRUUuUmF5Y2FzdGVyKClcbiAgICAgICAgICAgICAgICB0aGlzLmhvdmVyUmF5TCA9IG5ldyBUSFJFRS5SYXkoKVxuICAgICAgICAgICAgICAgIHRoaXMuaG92ZXJSYXlSID0gbmV3IFRIUkVFLlJheSgpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5zY3JpcHQuaXNOZXR3b3JrZWQpIHtcbiAgICAgICAgICAgICAgICAvLyBUaGlzIGZ1bmN0aW9uIGZpbmRzIGFuIGV4aXN0aW5nIGNvcHkgb2YgdGhlIE5ldHdvcmtlZCBFbnRpdHkgKGlmIHdlIGFyZSBub3QgdGhlXG4gICAgICAgICAgICAgICAgLy8gZmlyc3QgY2xpZW50IGluIHRoZSByb29tIGl0IHdpbGwgZXhpc3QgaW4gb3RoZXIgY2xpZW50cyBhbmQgYmUgY3JlYXRlZCBieSBOQUYpXG4gICAgICAgICAgICAgICAgLy8gb3IgY3JlYXRlIGFuIGVudGl0eSBpZiB3ZSBhcmUgZmlyc3QuXG4gICAgICAgICAgICAgICAgdGhpcy5zZXR1cE5ldHdvcmtlZEVudGl0eSA9IGZ1bmN0aW9uIChuZXR3b3JrZWRFbCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcGVyc2lzdGVudCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHZhciBuZXRJZDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG5ldHdvcmtlZEVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBXZSB3aWxsIGJlIHBhcnQgb2YgYSBOZXR3b3JrZWQgR0xURiBpZiB0aGUgR0xURiB3YXMgZHJvcHBlZCBvbiB0aGUgc2NlbmVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG9yIHBpbm5lZCBhbmQgbG9hZGVkIHdoZW4gd2UgZW50ZXIgdGhlIHJvb20uICBVc2UgdGhlIG5ldHdvcmtlZCBwYXJlbnRzXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBuZXR3b3JrSWQgcGx1cyBhIGRpc2FtYmlndWF0aW5nIGJpdCBvZiB0ZXh0IHRvIGNyZWF0ZSBhIHVuaXF1ZSBJZC5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldElkID0gTkFGLnV0aWxzLmdldE5ldHdvcmtJZChuZXR3b3JrZWRFbCkgKyBcIi1odG1sLXNjcmlwdFwiO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBpZiB3ZSBuZWVkIHRvIGNyZWF0ZSBhbiBlbnRpdHksIHVzZSB0aGUgc2FtZSBwZXJzaXN0ZW5jZSBhcyBvdXJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5ldHdvcmsgZW50aXR5ICh0cnVlIGlmIHBpbm5lZCwgZmFsc2UgaWYgbm90KVxuICAgICAgICAgICAgICAgICAgICAgICAgcGVyc2lzdGVudCA9IGVudGl0eS5jb21wb25lbnRzLm5ldHdvcmtlZC5kYXRhLnBlcnNpc3RlbnQ7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGlzIG9ubHkgaGFwcGVucyBpZiB0aGlzIGNvbXBvbmVudCBpcyBvbiBhIHNjZW5lIGZpbGUsIHNpbmNlIHRoZVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZWxlbWVudHMgb24gdGhlIHNjZW5lIGFyZW4ndCBuZXR3b3JrZWQuICBTbyBsZXQncyBhc3N1bWUgZWFjaCBlbnRpdHkgaW4gdGhlXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzY2VuZSB3aWxsIGhhdmUgYSB1bmlxdWUgbmFtZS4gIEFkZGluZyBhIGJpdCBvZiB0ZXh0IHNvIHdlIGNhbiBmaW5kIGl0XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBpbiB0aGUgRE9NIHdoZW4gZGVidWdnaW5nLlxuICAgICAgICAgICAgICAgICAgICAgICAgbmV0SWQgPSB0aGlzLmZ1bGxOYW1lLnJlcGxhY2VBbGwoXCJfXCIsXCItXCIpICsgXCItaHRtbC1zY3JpcHRcIlxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gY2hlY2sgaWYgdGhlIG5ldHdvcmtlZCBlbnRpdHkgd2UgY3JlYXRlIGZvciB0aGlzIGNvbXBvbmVudCBhbHJlYWR5IGV4aXN0cy4gXG4gICAgICAgICAgICAgICAgICAgIC8vIG90aGVyd2lzZSwgY3JlYXRlIGl0XG4gICAgICAgICAgICAgICAgICAgIC8vIC0gTk9URTogaXQgaXMgY3JlYXRlZCBvbiB0aGUgc2NlbmUsIG5vdCBhcyBhIGNoaWxkIG9mIHRoaXMgZW50aXR5LCBiZWNhdXNlXG4gICAgICAgICAgICAgICAgICAgIC8vICAgTkFGIGNyZWF0ZXMgcmVtb3RlIGVudGl0aWVzIGluIHRoZSBzY2VuZS5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGVudGl0eTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKE5BRi5lbnRpdGllcy5oYXNFbnRpdHkobmV0SWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnRpdHkgPSBOQUYuZW50aXRpZXMuZ2V0RW50aXR5KG5ldElkKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EtZW50aXR5JylcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3RvcmUgdGhlIG1ldGhvZCB0byByZXRyaWV2ZSB0aGUgc2NyaXB0IGRhdGEgb24gdGhpcyBlbnRpdHlcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eS5nZXRTaGFyZWREYXRhID0gdGhpcy5nZXRTaGFyZWREYXRhO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgXCJuZXR3b3JrZWRcIiBjb21wb25lbnQgc2hvdWxkIGhhdmUgcGVyc2lzdGVudD10cnVlLCB0aGUgdGVtcGxhdGUgYW5kIFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gbmV0d29ya0lkIHNldCwgb3duZXIgc2V0IHRvIFwic2NlbmVcIiAoc28gdGhhdCBpdCBkb2Vzbid0IHVwZGF0ZSB0aGUgcmVzdCBvZlxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHdvcmxkIHdpdGggaXQncyBpbml0aWFsIGRhdGEsIGFuZCBzaG91bGQgTk9UIHNldCBjcmVhdG9yICh0aGUgc3lzdGVtIHdpbGwgZG8gdGhhdClcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudGl0eS5zZXRBdHRyaWJ1dGUoJ25ldHdvcmtlZCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogXCIjc2NyaXB0LWRhdGEtbWVkaWFcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJzaXN0ZW50OiBwZXJzaXN0ZW50LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG93bmVyOiBcInNjZW5lXCIsICAvLyBzbyB0aGF0IG91ciBpbml0aWFsIHZhbHVlIGRvZXNuJ3Qgb3ZlcndyaXRlIG90aGVyc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ldHdvcmtJZDogbmV0SWRcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbC5zY2VuZUVsLmFwcGVuZENoaWxkKGVudGl0eSk7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyBzYXZlIGEgcG9pbnRlciB0byB0aGUgbmV0d29ya2VkIGVudGl0eSBhbmQgdGhlbiB3YWl0IGZvciBpdCB0byBiZSBmdWxseVxuICAgICAgICAgICAgICAgICAgICAvLyBpbml0aWFsaXplZCBiZWZvcmUgZ2V0dGluZyBhIHBvaW50ZXIgdG8gdGhlIGFjdHVhbCBuZXR3b3JrZWQgY29tcG9uZW50IGluIGl0XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubmV0RW50aXR5ID0gZW50aXR5O1xuICAgICAgICAgICAgICAgICAgICBOQUYudXRpbHMuZ2V0TmV0d29ya2VkRW50aXR5KHRoaXMubmV0RW50aXR5KS50aGVuKG5ldHdvcmtlZEVsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdGVTeW5jID0gbmV0d29ya2VkRWwuY29tcG9uZW50c1tcInNjcmlwdC1kYXRhXCJdXG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGlmIHRoaXMgaXMgdGhlIGZpcnN0IG5ldHdvcmtlZCBlbnRpdHksIGl0J3Mgc2hhcmVkRGF0YSB3aWxsIGRlZmF1bHQgdG8gdGhlIGVtcHR5IFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc3RyaW5nLCBhbmQgd2Ugc2hvdWxkIGluaXRpYWxpemUgaXQgd2l0aCB0aGUgaW5pdGlhbCBkYXRhIGZyb20gdGhlIHNjcmlwdFxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc3RhdGVTeW5jLnNoYXJlZERhdGEgPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgbmV0d29ya2VkID0gbmV0d29ya2VkRWwuY29tcG9uZW50c1tcIm5ldHdvcmtlZFwiXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGlmIChuZXR3b3JrZWQuZGF0YS5jcmVhdG9yID09IE5BRi5jbGllbnRJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vICAgICB0aGlzLnN0YXRlU3luYy5pbml0U2hhcmVkRGF0YSh0aGlzLnNjcmlwdC5nZXRTaGFyZWREYXRhKCkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnNldHVwTmV0d29ya2VkRW50aXR5ID0gdGhpcy5zZXR1cE5ldHdvcmtlZEVudGl0eS5iaW5kKHRoaXMpXG5cbiAgICAgICAgICAgICAgICB0aGlzLnNldHVwTmV0d29ya2VkID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICBOQUYudXRpbHMuZ2V0TmV0d29ya2VkRW50aXR5KHRoaXMuZWwpLnRoZW4obmV0d29ya2VkRWwgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXR1cE5ldHdvcmtlZEVudGl0eShuZXR3b3JrZWRFbClcbiAgICAgICAgICAgICAgICAgICAgfSkuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXR1cE5ldHdvcmtlZEVudGl0eSgpXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRoaXMuc2V0dXBOZXR3b3JrZWQgPSB0aGlzLnNldHVwTmV0d29ya2VkLmJpbmQodGhpcylcblxuICAgICAgICAgICAgICAgIC8vIFRoaXMgbWV0aG9kIGhhbmRsZXMgdGhlIGRpZmZlcmVudCBzdGFydHVwIGNhc2VzOlxuICAgICAgICAgICAgICAgIC8vIC0gaWYgdGhlIEdMVEYgd2FzIGRyb3BwZWQgb24gdGhlIHNjZW5lLCBOQUYgd2lsbCBiZSBjb25uZWN0ZWQgYW5kIHdlIGNhbiBcbiAgICAgICAgICAgICAgICAvLyAgIGltbWVkaWF0ZWx5IGluaXRpYWxpemVcbiAgICAgICAgICAgICAgICAvLyAtIGlmIHRoZSBHTFRGIGlzIGluIHRoZSByb29tIHNjZW5lIG9yIHBpbm5lZCwgaXQgd2lsbCBsaWtlbHkgYmUgY3JlYXRlZFxuICAgICAgICAgICAgICAgIC8vICAgYmVmb3JlIE5BRiBpcyBzdGFydGVkIGFuZCBjb25uZWN0ZWQsIHNvIHdlIHdhaXQgZm9yIGFuIGV2ZW50IHRoYXQgaXNcbiAgICAgICAgICAgICAgICAvLyAgIGZpcmVkIHdoZW4gSHVicyBoYXMgc3RhcnRlZCBOQUZcbiAgICAgICAgICAgICAgICBpZiAoTkFGLmNvbm5lY3Rpb24gJiYgTkFGLmNvbm5lY3Rpb24uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldHVwTmV0d29ya2VkKCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbC5zY2VuZUVsLmFkZEV2ZW50TGlzdGVuZXIoJ2RpZENvbm5lY3RUb05ldHdvcmtlZFNjZW5lJywgdGhpcy5zZXR1cE5ldHdvcmtlZClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSxcblxuICAgIHBsYXk6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMuc2NyaXB0KSB7XG4gICAgICAgICAgICB0aGlzLnNjcmlwdC5wbGF5KClcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBwYXVzZTogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5zY3JpcHQpIHtcbiAgICAgICAgICAgIHRoaXMuc2NyaXB0LnBhdXNlKClcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICAvLyBoYW5kbGUgXCJpbnRlcmFjdFwiIGV2ZW50cyBmb3IgY2xpY2thYmxlIGVudGl0aWVzXG4gICAgY2xpY2tlZDogZnVuY3Rpb24oZXZ0KSB7XG4gICAgICAgIHRoaXMuc2NyaXB0LmNsaWNrZWQoZXZ0KSBcbiAgICB9LFxuICBcbiAgICAvLyBtZXRob2RzIHRoYXQgd2lsbCBiZSBwYXNzZWQgdG8gdGhlIGh0bWwgb2JqZWN0IHNvIHRoZXkgY2FuIHVwZGF0ZSBuZXR3b3JrZWQgZGF0YVxuICAgIHRha2VPd25lcnNoaXA6IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAodGhpcy5zdGF0ZVN5bmMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN0YXRlU3luYy50YWtlT3duZXJzaGlwKClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlOyAgLy8gc3VyZSwgZ28gYWhlYWQgYW5kIGNoYW5nZSBpdCBmb3Igbm93XG4gICAgICAgIH1cbiAgICB9LFxuICAgIFxuICAgIHNldFNoYXJlZERhdGE6IGZ1bmN0aW9uKGRhdGFPYmplY3QpIHtcbiAgICAgICAgaWYgKHRoaXMuc3RhdGVTeW5jKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZVN5bmMuc2V0U2hhcmVkRGF0YShkYXRhT2JqZWN0KVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgfSxcblxuICAgIC8vIHRoaXMgaXMgY2FsbGVkIGZyb20gYmVsb3csIHRvIGdldCB0aGUgaW5pdGlhbCBkYXRhIGZyb20gdGhlIHNjcmlwdFxuICAgIGdldFNoYXJlZERhdGE6IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAodGhpcy5zY3JpcHQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnNjcmlwdC5nZXRTaGFyZWREYXRhKClcbiAgICAgICAgfVxuICAgICAgICAvLyBzaG91bGRuJ3QgaGFwcGVuXG4gICAgICAgIGNvbnNvbGUud2FybihcInNjcmlwdC1kYXRhIGNvbXBvbmVudCBjYWxsZWQgcGFyZW50IGVsZW1lbnQgYnV0IHRoZXJlIGlzIG5vIHNjcmlwdCB5ZXQ/XCIpXG4gICAgICAgIHJldHVybiBcInt9XCJcbiAgICB9LFxuXG4gICAgLy8gcGVyIGZyYW1lIHN0dWZmXG4gICAgdGljazogZnVuY3Rpb24gKHRpbWUpIHtcbiAgICAgICAgaWYgKCF0aGlzLnNjcmlwdCkgcmV0dXJuXG5cbiAgICAgICAgaWYgKHRoaXMuc2NyaXB0LmlzSW50ZXJhY3RpdmUpIHtcbiAgICAgICAgICAgIC8vIG1vcmUgb3IgbGVzcyBjb3BpZWQgZnJvbSBcImhvdmVyYWJsZS12aXN1YWxzLmpzXCIgaW4gaHVic1xuICAgICAgICAgICAgY29uc3QgdG9nZ2xpbmcgPSB0aGlzLmVsLnNjZW5lRWwuc3lzdGVtc1tcImh1YnMtc3lzdGVtc1wiXS5jdXJzb3JUb2dnbGluZ1N5c3RlbTtcbiAgICAgICAgICAgIHZhciBwYXNzdGhydUludGVyYWN0b3IgPSBbXVxuXG4gICAgICAgICAgICBsZXQgaW50ZXJhY3Rvck9uZSwgaW50ZXJhY3RvclR3bztcbiAgICAgICAgICAgIGNvbnN0IGludGVyYWN0aW9uID0gdGhpcy5lbC5zY2VuZUVsLnN5c3RlbXMuaW50ZXJhY3Rpb247XG4gICAgICAgICAgICBpZiAoIWludGVyYWN0aW9uLnJlYWR5KSByZXR1cm47IC8vRE9NQ29udGVudFJlYWR5IHdvcmthcm91bmRcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgbGV0IGhvdmVyRWwgPSB0aGlzLnNpbXBsZUNvbnRhaW5lclxuICAgICAgICAgICAgaWYgKGludGVyYWN0aW9uLnN0YXRlLmxlZnRIYW5kLmhvdmVyZWQgPT09IGhvdmVyRWwgJiYgIWludGVyYWN0aW9uLnN0YXRlLmxlZnRIYW5kLmhlbGQpIHtcbiAgICAgICAgICAgICAgaW50ZXJhY3Rvck9uZSA9IGludGVyYWN0aW9uLm9wdGlvbnMubGVmdEhhbmQuZW50aXR5Lm9iamVjdDNEO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICBpbnRlcmFjdGlvbi5zdGF0ZS5sZWZ0UmVtb3RlLmhvdmVyZWQgPT09IGhvdmVyRWwgJiZcbiAgICAgICAgICAgICAgIWludGVyYWN0aW9uLnN0YXRlLmxlZnRSZW1vdGUuaGVsZCAmJlxuICAgICAgICAgICAgICAhdG9nZ2xpbmcubGVmdFRvZ2dsZWRPZmZcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICBpbnRlcmFjdG9yT25lID0gaW50ZXJhY3Rpb24ub3B0aW9ucy5sZWZ0UmVtb3RlLmVudGl0eS5vYmplY3QzRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpbnRlcmFjdG9yT25lKSB7XG4gICAgICAgICAgICAgICAgbGV0IHBvcyA9IGludGVyYWN0b3JPbmUucG9zaXRpb25cbiAgICAgICAgICAgICAgICBsZXQgZGlyID0gdGhpcy5zY3JpcHQud2ViTGF5ZXIzRC5nZXRXb3JsZERpcmVjdGlvbihuZXcgVEhSRUUuVmVjdG9yMygpKS5uZWdhdGUoKVxuICAgICAgICAgICAgICAgIHBvcy5hZGRTY2FsZWRWZWN0b3IoZGlyLCAtMC4xKVxuICAgICAgICAgICAgICAgIHRoaXMuaG92ZXJSYXlMLnNldChwb3MsIGRpcilcblxuICAgICAgICAgICAgICAgIHBhc3N0aHJ1SW50ZXJhY3Rvci5wdXNoKHRoaXMuaG92ZXJSYXlMKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICBpbnRlcmFjdGlvbi5zdGF0ZS5yaWdodFJlbW90ZS5ob3ZlcmVkID09PSBob3ZlckVsICYmXG4gICAgICAgICAgICAgICFpbnRlcmFjdGlvbi5zdGF0ZS5yaWdodFJlbW90ZS5oZWxkICYmXG4gICAgICAgICAgICAgICF0b2dnbGluZy5yaWdodFRvZ2dsZWRPZmZcbiAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICBpbnRlcmFjdG9yVHdvID0gaW50ZXJhY3Rpb24ub3B0aW9ucy5yaWdodFJlbW90ZS5lbnRpdHkub2JqZWN0M0Q7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaW50ZXJhY3Rpb24uc3RhdGUucmlnaHRIYW5kLmhvdmVyZWQgPT09IGhvdmVyRWwgJiYgIWludGVyYWN0aW9uLnN0YXRlLnJpZ2h0SGFuZC5oZWxkKSB7XG4gICAgICAgICAgICAgICAgaW50ZXJhY3RvclR3byA9IGludGVyYWN0aW9uLm9wdGlvbnMucmlnaHRIYW5kLmVudGl0eS5vYmplY3QzRDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpbnRlcmFjdG9yVHdvKSB7XG4gICAgICAgICAgICAgICAgbGV0IHBvcyA9IGludGVyYWN0b3JUd28ucG9zaXRpb25cbiAgICAgICAgICAgICAgICBsZXQgZGlyID0gdGhpcy5zY3JpcHQud2ViTGF5ZXIzRC5nZXRXb3JsZERpcmVjdGlvbihuZXcgVEhSRUUuVmVjdG9yMygpKS5uZWdhdGUoKVxuICAgICAgICAgICAgICAgIHBvcy5hZGRTY2FsZWRWZWN0b3IoZGlyLCAtMC4xKVxuICAgICAgICAgICAgICAgIHRoaXMuaG92ZXJSYXlSLnNldChwb3MsIGRpcilcbiAgICAgICAgICAgICAgICBwYXNzdGhydUludGVyYWN0b3IucHVzaCh0aGlzLmhvdmVyUmF5UilcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5zY3JpcHQud2ViTGF5ZXIzRC5pbnRlcmFjdGlvblJheXMgPSBwYXNzdGhydUludGVyYWN0b3JcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnNjcmlwdC5pc05ldHdvcmtlZCkge1xuICAgICAgICAgICAgLy8gaWYgd2UgaGF2ZW4ndCBmaW5pc2hlZCBzZXR0aW5nIHVwIHRoZSBuZXR3b3JrZWQgZW50aXR5IGRvbid0IGRvIGFueXRoaW5nLlxuICAgICAgICAgICAgaWYgKCF0aGlzLm5ldEVudGl0eSB8fCAhdGhpcy5zdGF0ZVN5bmMpIHsgcmV0dXJuIH1cblxuICAgICAgICAgICAgLy8gaWYgdGhlIHN0YXRlIGhhcyBjaGFuZ2VkIGluIHRoZSBuZXR3b3JrZWQgZGF0YSwgdXBkYXRlIG91ciBodG1sIG9iamVjdFxuICAgICAgICAgICAgaWYgKHRoaXMuc3RhdGVTeW5jLmNoYW5nZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRlU3luYy5jaGFuZ2VkID0gZmFsc2VcbiAgICAgICAgICAgICAgICB0aGlzLnNjcmlwdC51cGRhdGVTaGFyZWREYXRhKHRoaXMuc3RhdGVTeW5jLmRhdGFPYmplY3QpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnNjcmlwdC50aWNrKHRpbWUpXG4gICAgfSxcbiAgXG4gIHBhcnNlTm9kZU5hbWU6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMuZnVsbE5hbWUgPT09IFwiXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZnVsbE5hbWUgPSB0aGlzLmVsLnBhcmVudEVsLnBhcmVudEVsLmNsYXNzTmFtZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gbm9kZXMgc2hvdWxkIGJlIG5hbWVkIGFueXRoaW5nIGF0IHRoZSBiZWdpbm5pbmcgd2l0aCBcbiAgICAgICAgLy8gIFwiY29tcG9uZW50TmFtZVwiXG4gICAgICAgIC8vIGF0IHRoZSB2ZXJ5IGVuZC4gIFRoaXMgd2lsbCBmZXRjaCB0aGUgY29tcG9uZW50IGZyb20gdGhlIHJlc291cmNlXG4gICAgICAgIC8vIGNvbXBvbmVudE5hbWVcbiAgICAgICAgY29uc3QgcGFyYW1zID0gdGhpcy5mdWxsTmFtZS5tYXRjaCgvXyhbQS1aYS16MC05XSopJC8pXG5cbiAgICAgICAgLy8gaWYgcGF0dGVybiBtYXRjaGVzLCB3ZSB3aWxsIGhhdmUgbGVuZ3RoIG9mIDMsIGZpcnN0IG1hdGNoIGlzIHRoZSBkaXIsXG4gICAgICAgIC8vIHNlY29uZCBpcyB0aGUgY29tcG9uZW50TmFtZSBuYW1lIG9yIG51bWJlclxuICAgICAgICBpZiAoIXBhcmFtcyB8fCBwYXJhbXMubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKFwiaHRtbC1zY3JpcHQgY29tcG9uZW50TmFtZSBub3QgZm9ybWF0dGVkIGNvcnJlY3RseTogXCIsIHRoaXMuZnVsbE5hbWUpXG4gICAgICAgICAgICB0aGlzLmNvbXBvbmVudE5hbWUgPSBudWxsXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNvbXBvbmVudE5hbWUgPSBwYXJhbXNbMV1cbiAgICAgICAgfVxuICB9LFxuXG4gIGxvYWRTY3JpcHQ6IGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gaWYgKHNjcmlwdFByb21pc2UpIHtcbiAgICAgICAgLy8gICAgIHRyeSB7XG4gICAgICAgIC8vICAgICAgICAgaHRtbENvbXBvbmVudHMgPSBhd2FpdCBzY3JpcHRQcm9taXNlO1xuICAgICAgICAvLyAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIC8vICAgICAgICAgY29uc29sZS5lcnJvcihlKTtcbiAgICAgICAgLy8gICAgICAgICByZXR1cm5cbiAgICAgICAgLy8gICAgIH1cbiAgICAgICAgLy8gICAgIHNjcmlwdFByb21pc2UgPSBudWxsXG4gICAgICAgIC8vIH1cbiAgICAgICAgdmFyIGluaXRTY3JpcHQgPSBodG1sQ29tcG9uZW50c1t0aGlzLmNvbXBvbmVudE5hbWVdXG4gICAgICAgIGlmICghaW5pdFNjcmlwdCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKFwiJ2h0bWwtc2NyaXB0JyBjb21wb25lbnQgZG9lc24ndCBoYXZlIHNjcmlwdCBmb3IgXCIgKyB0aGlzLmNvbXBvbmVudE5hbWUpO1xuICAgICAgICAgICAgdGhpcy5zY3JpcHQgPSBudWxsXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zY3JpcHQgPSBpbml0U2NyaXB0KClcbiAgICAgICAgaWYgKHRoaXMuc2NyaXB0KXtcbiAgICAgICAgICAgIHRoaXMuc2NyaXB0Lm5lZWRzVXBkYXRlID0gdHJ1ZVxuICAgICAgICAgICAgLy8gdGhpcy5zY3JpcHQud2ViTGF5ZXIzRC5yZWZyZXNoKHRydWUpXG4gICAgICAgICAgICAvLyB0aGlzLnNjcmlwdC53ZWJMYXllcjNELnVwZGF0ZSh0cnVlKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKFwiJ2h0bWwtc2NyaXB0JyBjb21wb25lbnQgZmFpbGVkIHRvIGluaXRpYWxpemUgc2NyaXB0IGZvciBcIiArIHRoaXMuY29tcG9uZW50TmFtZSk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgZGVzdHJveVNjcmlwdDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAodGhpcy5zY3JpcHQuaXNJbnRlcmFjdGl2ZSkge1xuICAgICAgICAgICAgdGhpcy5zaW1wbGVDb250YWluZXIub2JqZWN0M0QucmVtb3ZlRXZlbnRMaXN0ZW5lcignaW50ZXJhY3QnLCB0aGlzLmNsaWNrZWQpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5lbC5yZW1vdmVDaGlsZCh0aGlzLnNpbXBsZUNvbnRhaW5lcilcbiAgICAgICAgdGhpcy5zaW1wbGVDb250YWluZXIgPSBudWxsXG5cbiAgICAgICAgdGhpcy5zY3JpcHQuZGVzdHJveSgpXG4gICAgICAgIHRoaXMuc2NyaXB0ID0gbnVsbFxuICAgIH1cbn0pXG5cbi8vXG4vLyBDb21wb25lbnQgZm9yIG91ciBuZXR3b3JrZWQgc3RhdGUuICBUaGlzIGNvbXBvbmVudCBkb2VzIG5vdGhpbmcgZXhjZXB0IGFsbCB1cyB0byBcbi8vIGNoYW5nZSB0aGUgc3RhdGUgd2hlbiBhcHByb3ByaWF0ZS4gV2UgY291bGQgc2V0IHRoaXMgdXAgdG8gc2lnbmFsIHRoZSBjb21wb25lbnQgYWJvdmUgd2hlblxuLy8gc29tZXRoaW5nIGhhcyBjaGFuZ2VkLCBpbnN0ZWFkIG9mIGhhdmluZyB0aGUgY29tcG9uZW50IGFib3ZlIHBvbGwgZWFjaCBmcmFtZS5cbi8vXG5cbkFGUkFNRS5yZWdpc3RlckNvbXBvbmVudCgnc2NyaXB0LWRhdGEnLCB7XG4gICAgc2NoZW1hOiB7XG4gICAgICAgIHNjcmlwdGRhdGE6IHt0eXBlOiBcInN0cmluZ1wiLCBkZWZhdWx0OiBcInt9XCJ9LFxuICAgIH0sXG4gICAgaW5pdDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnRha2VPd25lcnNoaXAgPSB0aGlzLnRha2VPd25lcnNoaXAuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5zZXRTaGFyZWREYXRhID0gdGhpcy5zZXRTaGFyZWREYXRhLmJpbmQodGhpcyk7XG5cbiAgICAgICAgdGhpcy5kYXRhT2JqZWN0ID0gdGhpcy5lbC5nZXRTaGFyZWREYXRhKCk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0aGlzLnNoYXJlZERhdGEgPSBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkodGhpcy5kYXRhT2JqZWN0KSlcbiAgICAgICAgICAgIHRoaXMuZWwuc2V0QXR0cmlidXRlKFwic2NyaXB0LWRhdGFcIiwgXCJzY3JpcHRkYXRhXCIsIHRoaXMuc2hhcmVkRGF0YSk7XG4gICAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkNvdWxkbid0IGVuY29kZSBpbml0aWFsIHNjcmlwdCBkYXRhIG9iamVjdDogXCIsIGUsIHRoaXMuZGF0YU9iamVjdClcbiAgICAgICAgICAgIHRoaXMuc2hhcmVkRGF0YSA9IFwie31cIlxuICAgICAgICAgICAgdGhpcy5kYXRhT2JqZWN0ID0ge31cbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNoYW5nZWQgPSBmYWxzZTtcbiAgICB9LFxuXG4gICAgdXBkYXRlKCkge1xuICAgICAgICB0aGlzLmNoYW5nZWQgPSAhKHRoaXMuc2hhcmVkRGF0YSA9PT0gdGhpcy5kYXRhLnNjcmlwdGRhdGEpO1xuICAgICAgICBpZiAodGhpcy5jaGFuZ2VkKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuZGF0YU9iamVjdCA9IEpTT04ucGFyc2UoZGVjb2RlVVJJQ29tcG9uZW50KHRoaXMuZGF0YS5zY3JpcHRkYXRhKSlcblxuICAgICAgICAgICAgICAgIC8vIGRvIHRoZXNlIGFmdGVyIHRoZSBKU09OIHBhcnNlIHRvIG1ha2Ugc3VyZSBpdCBoYXMgc3VjY2VlZGVkXG4gICAgICAgICAgICAgICAgdGhpcy5zaGFyZWREYXRhID0gdGhpcy5kYXRhLnNjcmlwdGRhdGE7XG4gICAgICAgICAgICAgICAgdGhpcy5jaGFuZ2VkID0gdHJ1ZVxuICAgICAgICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcImNvdWxkbid0IHBhcnNlIEpTT04gcmVjZWl2ZWQgaW4gc2NyaXB0LXN5bmM6IFwiLCBlKVxuICAgICAgICAgICAgICAgIHRoaXMuc2hhcmVkRGF0YSA9IFwiXCJcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGFPYmplY3QgPSB7fVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8vIGl0IGlzIGxpa2VseSB0aGF0IGFwcGx5UGVyc2lzdGVudFN5bmMgb25seSBuZWVkcyB0byBiZSBjYWxsZWQgZm9yIHBlcnNpc3RlbnRcbiAgICAvLyBuZXR3b3JrZWQgZW50aXRpZXMsIHNvIHdlIF9wcm9iYWJseV8gZG9uJ3QgbmVlZCB0byBkbyB0aGlzLiAgQnV0IGlmIHRoZXJlIGlzIG5vXG4gICAgLy8gcGVyc2lzdGVudCBkYXRhIHNhdmVkIGZyb20gdGhlIG5ldHdvcmsgZm9yIHRoaXMgZW50aXR5LCB0aGlzIGNvbW1hbmQgZG9lcyBub3RoaW5nLlxuICAgIHBsYXkoKSB7XG4gICAgICAgIGlmICh0aGlzLmVsLmNvbXBvbmVudHMubmV0d29ya2VkKSB7XG4gICAgICAgICAgICAvLyBub3Qgc3VyZSBpZiB0aGlzIGlzIHJlYWxseSBuZWVkZWQsIGJ1dCBjYW4ndCBodXJ0XG4gICAgICAgICAgICBpZiAoQVBQLnV0aWxzKSB7IC8vIHRlbXBvcmFyeSB0aWxsIHdlIHNoaXAgbmV3IGNsaWVudFxuICAgICAgICAgICAgICAgIEFQUC51dGlscy5hcHBseVBlcnNpc3RlbnRTeW5jKHRoaXMuZWwuY29tcG9uZW50cy5uZXR3b3JrZWQuZGF0YS5uZXR3b3JrSWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcblxuICAgIHRha2VPd25lcnNoaXAoKSB7XG4gICAgICAgIGlmICghTkFGLnV0aWxzLmlzTWluZSh0aGlzLmVsKSAmJiAhTkFGLnV0aWxzLnRha2VPd25lcnNoaXAodGhpcy5lbCkpIHJldHVybiBmYWxzZTtcblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuXG4gICAgLy8gaW5pdFNoYXJlZERhdGEoZGF0YU9iamVjdCkge1xuICAgIC8vICAgICB0cnkge1xuICAgIC8vICAgICAgICAgdmFyIGh0bWxTdHJpbmcgPSBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkoZGF0YU9iamVjdCkpXG4gICAgLy8gICAgICAgICB0aGlzLnNoYXJlZERhdGEgPSBodG1sU3RyaW5nXG4gICAgLy8gICAgICAgICB0aGlzLmRhdGFPYmplY3QgPSBkYXRhT2JqZWN0XG4gICAgLy8gICAgICAgICByZXR1cm4gdHJ1ZVxuICAgIC8vICAgICB9IGNhdGNoIChlKSB7XG4gICAgLy8gICAgICAgICBjb25zb2xlLmVycm9yKFwiY2FuJ3Qgc3RyaW5naWZ5IHRoZSBvYmplY3QgcGFzc2VkIHRvIHNjcmlwdC1zeW5jXCIpXG4gICAgLy8gICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAvLyAgICAgfVxuICAgIC8vIH0sXG5cbiAgICAvLyBUaGUga2V5IHBhcnQgaW4gdGhlc2UgbWV0aG9kcyAod2hpY2ggYXJlIGNhbGxlZCBmcm9tIHRoZSBjb21wb25lbnQgYWJvdmUpIGlzIHRvXG4gICAgLy8gY2hlY2sgaWYgd2UgYXJlIGFsbG93ZWQgdG8gY2hhbmdlIHRoZSBuZXR3b3JrZWQgb2JqZWN0LiAgSWYgd2Ugb3duIGl0IChpc01pbmUoKSBpcyB0cnVlKVxuICAgIC8vIHdlIGNhbiBjaGFuZ2UgaXQuICBJZiB3ZSBkb24ndCBvd24gaW4sIHdlIGNhbiB0cnkgdG8gYmVjb21lIHRoZSBvd25lciB3aXRoXG4gICAgLy8gdGFrZU93bmVyc2hpcCgpLiBJZiB0aGlzIHN1Y2NlZWRzLCB3ZSBjYW4gc2V0IHRoZSBkYXRhLiAgXG4gICAgLy9cbiAgICAvLyBOT1RFOiB0YWtlT3duZXJzaGlwIEFUVEVNUFRTIHRvIGJlY29tZSB0aGUgb3duZXIsIGJ5IGFzc3VtaW5nIGl0IGNhbiBiZWNvbWUgdGhlXG4gICAgLy8gb3duZXIgYW5kIG5vdGlmeWluZyB0aGUgbmV0d29ya2VkIGNvcGllcy4gIElmIHR3byBvciBtb3JlIGVudGl0aWVzIHRyeSB0byBiZWNvbWVcbiAgICAvLyBvd25lciwgIG9ubHkgb25lICh0aGUgbGFzdCBvbmUgdG8gdHJ5KSBiZWNvbWVzIHRoZSBvd25lci4gIEFueSBzdGF0ZSB1cGRhdGVzIGRvbmVcbiAgICAvLyBieSB0aGUgXCJmYWlsZWQgYXR0ZW1wdGVkIG93bmVyc1wiIHdpbGwgbm90IGJlIGRpc3RyaWJ1dGVkIHRvIHRoZSBvdGhlciBjbGllbnRzLFxuICAgIC8vIGFuZCB3aWxsIGJlIG92ZXJ3cml0dGVuIChldmVudHVhbGx5KSBieSB1cGRhdGVzIGZyb20gdGhlIG90aGVyIGNsaWVudHMuICAgQnkgbm90XG4gICAgLy8gYXR0ZW1wdGluZyB0byBndWFyYW50ZWUgb3duZXJzaGlwLCB0aGlzIGNhbGwgaXMgZmFzdCBhbmQgc3luY2hyb25vdXMuICBBbnkgXG4gICAgLy8gbWV0aG9kcyBmb3IgZ3VhcmFudGVlaW5nIG93bmVyc2hpcCBjaGFuZ2Ugd291bGQgdGFrZSBhIG5vbi10cml2aWFsIGFtb3VudCBvZiB0aW1lXG4gICAgLy8gYmVjYXVzZSBvZiBuZXR3b3JrIGxhdGVuY2llcy5cblxuICAgIHNldFNoYXJlZERhdGEoZGF0YU9iamVjdCkge1xuICAgICAgICBpZiAoIU5BRi51dGlscy5pc01pbmUodGhpcy5lbCkgJiYgIU5BRi51dGlscy50YWtlT3duZXJzaGlwKHRoaXMuZWwpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHZhciBodG1sU3RyaW5nID0gZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KGRhdGFPYmplY3QpKVxuICAgICAgICAgICAgdGhpcy5zaGFyZWREYXRhID0gaHRtbFN0cmluZ1xuICAgICAgICAgICAgdGhpcy5kYXRhT2JqZWN0ID0gZGF0YU9iamVjdFxuICAgICAgICAgICAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoXCJzY3JpcHQtZGF0YVwiLCBcInNjcmlwdGRhdGFcIiwgaHRtbFN0cmluZyk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiY2FuJ3Qgc3RyaW5naWZ5IHRoZSBvYmplY3QgcGFzc2VkIHRvIHNjcmlwdC1zeW5jXCIpXG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgIH1cbn0pO1xuXG4vLyBBZGQgb3VyIHRlbXBsYXRlIGZvciBvdXIgbmV0d29ya2VkIG9iamVjdCB0byB0aGUgYS1mcmFtZSBhc3NldHMgb2JqZWN0LFxuLy8gYW5kIGEgc2NoZW1hIHRvIHRoZSBOQUYuc2NoZW1hcy4gIEJvdGggbXVzdCBiZSB0aGVyZSB0byBoYXZlIGN1c3RvbSBjb21wb25lbnRzIHdvcmtcblxuY29uc3QgYXNzZXRzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcImEtYXNzZXRzXCIpO1xuXG5hc3NldHMuaW5zZXJ0QWRqYWNlbnRIVE1MKFxuICAgICdiZWZvcmVlbmQnLFxuICAgIGBcbiAgICA8dGVtcGxhdGUgaWQ9XCJzY3JpcHQtZGF0YS1tZWRpYVwiPlxuICAgICAgPGEtZW50aXR5XG4gICAgICAgIHNjcmlwdC1kYXRhXG4gICAgICA+PC9hLWVudGl0eT5cbiAgICA8L3RlbXBsYXRlPlxuICBgXG4gIClcblxuY29uc3QgdmVjdG9yUmVxdWlyZXNVcGRhdGUgPSBlcHNpbG9uID0+IHtcblx0XHRyZXR1cm4gKCkgPT4ge1xuXHRcdFx0bGV0IHByZXYgPSBudWxsO1xuXHRcdFx0cmV0dXJuIGN1cnIgPT4ge1xuXHRcdFx0XHRpZiAocHJldiA9PT0gbnVsbCkge1xuXHRcdFx0XHRcdHByZXYgPSBuZXcgVEhSRUUuVmVjdG9yMyhjdXJyLngsIGN1cnIueSwgY3Vyci56KTtcblx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0fSBlbHNlIGlmICghTkFGLnV0aWxzLmFsbW9zdEVxdWFsVmVjMyhwcmV2LCBjdXJyLCBlcHNpbG9uKSkge1xuXHRcdFx0XHRcdHByZXYuY29weShjdXJyKTtcblx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHR9O1xuXHRcdH07XG5cdH07XG5cbk5BRi5zY2hlbWFzLmFkZCh7XG4gIFx0dGVtcGxhdGU6IFwiI3NjcmlwdC1kYXRhLW1lZGlhXCIsXG4gICAgY29tcG9uZW50czogW1xuICAgIC8vIHtcbiAgICAvLyAgICAgY29tcG9uZW50OiBcInNjcmlwdC1kYXRhXCIsXG4gICAgLy8gICAgIHByb3BlcnR5OiBcInJvdGF0aW9uXCIsXG4gICAgLy8gICAgIHJlcXVpcmVzTmV0d29ya1VwZGF0ZTogdmVjdG9yUmVxdWlyZXNVcGRhdGUoMC4wMDEpXG4gICAgLy8gfSxcbiAgICAvLyB7XG4gICAgLy8gICAgIGNvbXBvbmVudDogXCJzY3JpcHQtZGF0YVwiLFxuICAgIC8vICAgICBwcm9wZXJ0eTogXCJzY2FsZVwiLFxuICAgIC8vICAgICByZXF1aXJlc05ldHdvcmtVcGRhdGU6IHZlY3RvclJlcXVpcmVzVXBkYXRlKDAuMDAxKVxuICAgIC8vIH0sXG4gICAge1xuICAgICAgXHRjb21wb25lbnQ6IFwic2NyaXB0LWRhdGFcIixcbiAgICAgIFx0cHJvcGVydHk6IFwic2NyaXB0ZGF0YVwiXG4gICAgfV0sXG4gICAgICBub25BdXRob3JpemVkQ29tcG9uZW50czogW1xuICAgICAge1xuICAgICAgICAgICAgY29tcG9uZW50OiBcInNjcmlwdC1kYXRhXCIsXG4gICAgICAgICAgICBwcm9wZXJ0eTogXCJzY3JpcHRkYXRhXCJcbiAgICAgIH1cbiAgICBdLFxuXG4gIH0pO1xuXG4iLCJpbXBvcnQgJy4uL3N5c3RlbXMvZmFkZXItcGx1cy5qcydcbmltcG9ydCAnLi4vY29tcG9uZW50cy9wb3J0YWwuanMnXG5pbXBvcnQgJy4uL2NvbXBvbmVudHMvaW1tZXJzaXZlLTM2MC5qcydcbmltcG9ydCAnLi4vY29tcG9uZW50cy9wYXJhbGxheC5qcydcbmltcG9ydCAnLi4vY29tcG9uZW50cy9odG1sLXNjcmlwdC5qcydcblxuQUZSQU1FLkdMVEZNb2RlbFBsdXMucmVnaXN0ZXJDb21wb25lbnQoJ2ltbWVyc2l2ZS0zNjAnLCAnaW1tZXJzaXZlLTM2MCcpXG5BRlJBTUUuR0xURk1vZGVsUGx1cy5yZWdpc3RlckNvbXBvbmVudCgncG9ydGFsJywgJ3BvcnRhbCcpXG5BRlJBTUUuR0xURk1vZGVsUGx1cy5yZWdpc3RlckNvbXBvbmVudCgncGFyYWxsYXgnLCAncGFyYWxsYXgnKVxuQUZSQU1FLkdMVEZNb2RlbFBsdXMucmVnaXN0ZXJDb21wb25lbnQoJ2h0bWwtc2NyaXB0JywgJ2h0bWwtc2NyaXB0JylcblxuLy8gZG8gYSBzaW1wbGUgbW9ua2V5IHBhdGNoIHRvIHNlZSBpZiBpdCB3b3Jrc1xuXG4vLyB2YXIgbXlpc01pbmVPckxvY2FsID0gZnVuY3Rpb24gKHRoYXQpIHtcbi8vICAgICByZXR1cm4gIXRoYXQuZWwuY29tcG9uZW50cy5uZXR3b3JrZWQgfHwgKHRoYXQubmV0d29ya2VkRWwgJiYgTkFGLnV0aWxzLmlzTWluZSh0aGF0Lm5ldHdvcmtlZEVsKSk7XG4vLyAgfVxuXG4vLyAgdmFyIHZpZGVvQ29tcCA9IEFGUkFNRS5jb21wb25lbnRzW1wibWVkaWEtdmlkZW9cIl1cbi8vICB2aWRlb0NvbXAuQ29tcG9uZW50LnByb3RvdHlwZS5pc01pbmVPckxvY2FsID0gbXlpc01pbmVPckxvY2FsOyJdLCJuYW1lcyI6WyJ3b3JsZENhbWVyYSIsIndvcmxkU2VsZiIsImdsc2wiLCJ2ZXJ0ZXhTaGFkZXIiLCJzbm9pc2UiLCJmcmFnbWVudFNoYWRlciJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Es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QUM7QUFDZDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTUEsTUFBSSxHQUFHLENBQUM7QUFDZDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3R0E7QUFDQTtBQUNBO0FBQ08sU0FBUyx5QkFBeUIsQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFO0FBQzNELElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLEVBQUUs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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxFQUFFLENBQUM7QUFDSDtBQUNBLEVBQUUsY0FBYyxFQUFFLElBQUksQ0FBQztBQUN2QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsRUFBRSxDQUFDO0FBQ0g7O0FDcExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUdBO0FBQ0EsTUFBTSxHQUFHLEdBQUcsSUFBSSxLQUFLLENBQUMsT0FBTyxH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
