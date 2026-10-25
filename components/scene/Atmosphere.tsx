'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useGame } from '@/lib/client/store';
import { liveHour } from '@/lib/client/clock';
import { QUALITY } from '@/lib/client/quality';
import { atmosphereAt, hourDiff, keyLightPosition, wrapHour, type RGB } from '@/lib/world/atmosphere';

const setRGB = (c: THREE.Color, [r, g, b]: RGB) => c.setRGB(r, g, b, THREE.SRGBColorSpace);

/**
 * Sky, sun, fill light, lamps, exposure and reflections, all driven by the household's clock.
 * Everything is eased every frame, so there are no visible steps between polls or at dawn and dusk.
 * Nothing here re-renders React: it only writes to light and renderer properties.
 */
export function Atmosphere() {
  const { gl, scene } = useThree();
  const quality = useGame((s) => s.quality);
  const q = QUALITY[quality];
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const lampA = useRef<THREE.PointLight>(null);
  const lampB = useRef<THREE.PointLight>(null);
  const shown = useRef<number | null>(null);
  const bg = useRef(new THREE.Color());
  const tmp = useRef(new THREE.Color());

  // Soft bounce light from a generated studio-style room: gives pastel materials depth without any image download.
  useEffect(() => {
    if (!q.envMap) { scene.environment = null; return; }
    const pm = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pm.fromScene(room, 0.04);
    scene.environment = rt.texture;
    pm.dispose();
    return () => { scene.environment = null; rt.dispose(); };
  }, [gl, scene, q.envMap]);

  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
  }, [gl]);

  useFrame((_, dt) => {
    const st = useGame.getState();
    const v = st.view;
    if (!v) return;
    const target = liveHour(v, st.clockOffset);
    if (shown.current === null) shown.current = target;
    else shown.current = wrapHour(shown.current + hourDiff(shown.current, target) * (1 - Math.exp(-2.5 * Math.min(dt, 0.1))));
    const hour = shown.current;
    const a = atmosphereAt(hour);

    if (sun.current) {
      setRGB(sun.current.color, a.sunColor);
      sun.current.intensity = a.sunIntensity;
      const [x, y, z] = keyLightPosition(hour);
      sun.current.position.set(x, y, z);
    }
    if (hemi.current) {
      setRGB(hemi.current.color, a.fillSky);
      setRGB(hemi.current.groundColor, a.fillGround);
      hemi.current.intensity = a.fillIntensity;
    }
    if (lampA.current) lampA.current.intensity = a.lamp * 7;
    if (lampB.current) lampB.current.intensity = a.lamp * 3.5;
    // Backdrop: horizon colour, tinted toward the zenith.
    setRGB(bg.current, a.skyHorizon);
    setRGB(tmp.current, a.skyTop);
    bg.current.lerp(tmp.current, 0.35);
    scene.background = bg.current;
    gl.toneMappingExposure = a.exposure;
    scene.environmentIntensity = a.envIntensity;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#dff1ff', '#f6e6d0', 0.9]} />
      <directionalLight
        ref={sun} position={[6, 10, 5]} intensity={1.6}
        castShadow={q.shadows} shadow-mapSize={[q.shadowMap, q.shadowMap]}
        shadow-bias={-0.0004} shadow-normalBias={0.03} shadow-radius={4}
        shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9}
        shadow-camera-near={1} shadow-camera-far={40}
      />
      {/* warm lamps, brought up smoothly as the light fades */}
      <pointLight ref={lampA} position={[-2.5, 1.8, -1]} color="#ffcf9a" intensity={0} distance={11} decay={1.6} />
      <pointLight ref={lampB} position={[2.2, 1.6, 1.5]} color="#ffdcb4" intensity={0} distance={9} decay={1.6} />
    </>
  );
}
