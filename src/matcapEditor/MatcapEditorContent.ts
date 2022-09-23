import {
    AmbientLight,
    ArrowHelper,
    Mesh,
    MeshBasicMaterial,
    MeshNormalMaterial,
    MeshPhysicalMaterial,
    OrthographicCamera,
    PlaneGeometry,
    Raycaster,
    SphereGeometry,
    SpotLight,
    Vector2,
    Vector3,
    type Intersection,
} from 'three';

import { getScreenPosition } from 'src/commons/VectorHelpers';
import events from '../commons/Events';
import { MatcapEditorStore, type IMatcapEditorStore } from '../store';
import type MatcapEditorWorld from './MatcapEditorWorld';
import LightModel from './LightModel';
import LightFabric from './LightFabric';

const data = {
    halfSize: 0.3,
    widthSegments: 256,
    heightSegments: 256,
};
data.heightSegments = data.widthSegments / (4 / 3);

let store: IMatcapEditorStore;
MatcapEditorStore.subscribe((value) => {
    store = value;
});

class MatcapEditorContent {
    private world: MatcapEditorWorld;

    private cameraSnapshot: OrthographicCamera;

    private plane: Mesh;

    private sphereRender: Mesh;

    private sphereRenderMaterial: MeshPhysicalMaterial;

    private sphereNormal: Mesh;

    private meshesIntersectable: Array<Mesh> = [];

    private ambiantLight: AmbientLight = new AmbientLight(0x000000);

    private arrowHelper: ArrowHelper = new ArrowHelper(
        new Vector3(),
        new Vector3(),
        1,
        '#ff0000',
    );

    private currentLightModel: LightModel;

    private raycaster: Raycaster = new Raycaster();

    private pointer: Vector2 = new Vector2();

    private hitSphere: Intersection;

    private lightPosition: Vector3 = new Vector3();

    private blobURL: string;

    private exported = false;

    constructor(world: MatcapEditorWorld) {
        this.world = world;

        const halfSize = 0.3;

        this.cameraSnapshot = new OrthographicCamera(
            -halfSize,
            halfSize,
            halfSize,
            -halfSize,
            0.5,
            200,
        );
        this.cameraSnapshot.position.set(0, 0, 1);

        const planeGeometry = new PlaneGeometry(2, 2);
        const planeMaterial = new MeshBasicMaterial({ color: 0x000000 });
        planeMaterial.transparent = true;
        planeMaterial.opacity = 0;
        this.plane = new Mesh(planeGeometry, planeMaterial);

        const sphereRenderGeometry = new SphereGeometry(
            0.3,
            data.widthSegments,
            data.heightSegments,
        );
        this.sphereRenderMaterial = new MeshPhysicalMaterial({
            color: 0xffffff,
        });
        this.sphereRenderMaterial.roughness = store.material.roughness;
        this.sphereRenderMaterial.metalness = store.material.metalness;
        this.sphereRender = new Mesh(
            sphereRenderGeometry,
            this.sphereRenderMaterial,
        );

        const sphereNormalGeometry = new SphereGeometry(
            0.4,
            data.widthSegments,
            data.heightSegments,
        );
        const sphereNormalMaterial = new MeshNormalMaterial({
            opacity: 0,
            transparent: true,
        });
        this.sphereNormal = new Mesh(
            sphereNormalGeometry,
            sphereNormalMaterial,
        );

        this.meshesIntersectable = [
            this.plane,
            this.sphereRender,
            this.sphereNormal,
        ];

        this.sphereRender.geometry.computeBoundsTree();
        this.sphereNormal.geometry.computeBoundsTree();

        this.world.scene.add(this.plane);
        this.world.scene.add(this.sphereRender);
        this.world.scene.add(this.sphereNormal);

        this.ambiantLight.intensity = store.ambiant.intensity;
        this.ambiantLight.color = store.ambiant.color;
        this.world.scene.add(this.ambiantLight);

        this.world.scene.add(this.arrowHelper);

        this.world.canvas.addEventListener('mouseover', this.onMouseOver);
        this.world.canvas.addEventListener('mouseout', this.onMouseOut);

        events.on('matcap:ambiant:update', this.onAmbiantChanged);
        events.on('matcap:snapshot', this.snapshot);
        events.on('matcap:export:png', this.snapshot);
        events.on('matcap:light:update:distance', this.updateLightDistance);
        events.on('matcap:light:delete', this.deleteLight);
        events.on('matcap:light:startMoving', this.onLightStartMoving);
        events.on('matcap:light:stopMoving', this.onLightStopMoving);

        this.world.canvas.addEventListener('pointerup', this.onPointerUp);

        events.emit('matcap:content:ready', this);
    }

    private onAmbiantChanged = () => {
        this.ambiantLight.intensity = store.ambiant.intensity;
        this.ambiantLight.color = store.ambiant.color;
        this.snapshot();
    };

    private onMouseOver = () => {
        this.arrowHelper.visible = true;
        this.world.canvas.addEventListener('pointermove', this.onPointerMove);
        this.world.canvas.addEventListener('pointerdown', this.onPointerDown);
    };

    private onMouseOut = () => {
        this.arrowHelper.visible = false;
        this.world.canvas.removeEventListener(
            'pointermove',
            this.onPointerMove,
        );
        this.world.canvas.removeEventListener(
            'pointerdown',
            this.onPointerDown,
        );
    };

    private onPointerDown = () => {
        if (!this.hitSphere) return;

        const positionOnSphere = this.hitSphere.point.clone();

        this.lightPosition = this.hitSphere.point.clone();
        this.lightPosition.add(
            this.hitSphere.face.normal
                .clone()
                .multiplyScalar(store.create.distance),
        );

        const instanceOfLight = LightFabric.getLightInstance(
            store.create.lightType,
        );
        instanceOfLight.position.x = this.lightPosition.x;
        instanceOfLight.position.y = this.lightPosition.y;
        if (store.create.front)
            instanceOfLight.position.z = this.lightPosition.z;
        else instanceOfLight.position.z = -this.lightPosition.z;

        this.world.scene.add(instanceOfLight);
        if (store.create.lightType === 'Spot')
            this.world.scene.add((instanceOfLight as SpotLight).target);

        const screenPosition = getScreenPosition(
            positionOnSphere
                .clone()
                .add(this.hitSphere.face.normal.clone().multiplyScalar(0.1)),
            this.world.camera,
            store.sizes.exportDefault,
            store.sizes.exportDefault,
        );

        const lightModel = new LightModel();
        lightModel.light = instanceOfLight;
        lightModel.screenPosition = screenPosition;
        lightModel.positionOnSphere = positionOnSphere;
        lightModel.sphereFaceNormal = this.hitSphere.face.normal.clone();
        lightModel.distance = Number(store.create.distance);

        events.emit('matcap:editor:light:added', lightModel);

        this.snapshot();
    };

    private onPointerMove = (event: PointerEvent) => {
        this.pointer.set(
            ((event.offsetX * store.ratio) / store.sizes.exportDefault) * 2 - 1,
            -((event.offsetY * store.ratio) / store.sizes.exportDefault) * 2 +
                1,
        );
        this.raycaster.setFromCamera(this.pointer, this.world.camera);
        const hits = this.raycaster.intersectObjects(this.meshesIntersectable);
        const hit = hits[0];

        if (!hit) return;

        if (hit.object === this.sphereNormal) {
            this.arrowHelper.setColor('#e5ff00');
            this.raycaster.set(
                hit.point,
                new Vector3().subVectors(new Vector3(), hit.point).normalize(),
            );
        } else if (hit.object === this.plane) {
            this.arrowHelper.setColor('#00ffee');
            this.raycaster.set(
                hit.point,
                new Vector3().subVectors(new Vector3(), hit.point).normalize(),
            );
        }
        const hits2 = this.raycaster.intersectObject(this.sphereRender);
        const hit2 = hits2[0];

        if (!hit2) return;

        this.arrowHelper.setDirection(hit2.face.normal);
        this.arrowHelper.setLength(0.1);
        this.arrowHelper.position.copy(hit2.point);

        this.hitSphere = hit2;

        if (this.currentLightModel) {
            const positionOnSphere = this.hitSphere.point.clone();
            this.lightPosition = positionOnSphere.clone();
            this.lightPosition.add(
                this.hitSphere.face.normal
                    .clone()
                    .multiplyScalar(this.currentLightModel.distance),
            );
            this.currentLightModel.light.position.x = this.lightPosition.x;
            this.currentLightModel.light.position.y = this.lightPosition.y;
            if (store.create.front)
                this.currentLightModel.light.position.z = this.lightPosition.z;
            else
                this.currentLightModel.light.position.z = -this.lightPosition.z;

            this.currentLightModel.update();

            const screenPosition = getScreenPosition(
                positionOnSphere
                    .clone()
                    .add(
                        this.hitSphere.face.normal.clone().multiplyScalar(0.1),
                    ),
                this.world.camera,
                store.sizes.exportDefault,
                store.sizes.exportDefault,
            );
            this.currentLightModel.screenPosition = screenPosition;
            this.currentLightModel.positionOnSphere = positionOnSphere;
            this.currentLightModel.sphereFaceNormal =
                this.hitSphere.face.normal.clone();
        }
    };

    private onPointerUp = () => {
        store.isUILightVisible = true;
        MatcapEditorStore.set(store);
        this.currentLightModel = null;
        this.snapshot();
    };

    private onLightStartMoving = (lightModel: LightModel) => {
        this.currentLightModel = lightModel;
    };

    private onLightStopMoving = () => {
        this.currentLightModel = null;
        this.snapshot();
    };

    private updateLightDistance = (lightModel: LightModel): void => {
        const lightPosition = lightModel.positionOnSphere.clone();
        lightPosition.add(
            lightModel.sphereFaceNormal
                .clone()
                .multiplyScalar(lightModel.distance),
        );
        lightModel.setPositionX(lightPosition.x);
        lightModel.setPositionY(lightPosition.y);
        if (store.create.front) lightModel.setPositionZ(lightPosition.z);
        else lightModel.setPositionZ(-lightPosition.z);

        this.snapshot();
    };

    private deleteLight = (lightModel: LightModel) => {
        this.world.scene.remove(lightModel.light);
    };

    private snapshot = (payload: { exported: false } = undefined) => {
        this.exported = payload?.exported;
        const arrowHelperVisibleState = this.arrowHelper.visible;
        this.arrowHelper.visible = false;
        if (this.exported) {
            this.world.renderer.setPixelRatio(store.sizes.exportRatio);
        } else {
            this.world.renderer.setPixelRatio(1);
        }
        this.world.renderer.render(this.world.scene, this.cameraSnapshot);
        this.arrowHelper.visible = arrowHelperVisibleState;
        this.world.renderer.domElement.toBlob(
            this.onBlobReady,
            'image/png',
            1.0,
        );
    };

    private onBlobReady = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        this.blobURL = url;
        if (this.exported) {
            this.exportPNG();
            this.world.renderer.setPixelRatio(1);
        } else events.emit('matcap:updateFromEditor', { url });
    };

    private exportPNG = () => {
        if (!this.blobURL) return;
        const a = document.createElement('a');
        a.href = this.blobURL;
        a.download = 'matcap.png';
        a.click();
    };
}
export default MatcapEditorContent;
