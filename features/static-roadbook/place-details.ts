import extraPhotos from '../../data/place-photos.json';
import { dayPhotos } from './photos';

type PlaceDetail = {
  photo:
    | (typeof dayPhotos)[string]
    | ((typeof extraPhotos)[keyof typeof extraPhotos] & { position?: string });
  intro: string;
  sourceUrl?: string;
};

export const placeDetails: Record<string, PlaceDetail> = {
  沈阳: {
    photo: dayPhotos.d6,
    intro:
      '这趟北行的起点，也是旅程结束后回到的城市。把城市夜色留在身后，接下来是草原、河流和森林；六天之后，再沿路回家。',
  },
  海拉尔: {
    photo: dayPhotos.d1,
    intro:
      '海拉尔河穿过城市，河岸风光和城区街景交织在一起。这里是路书中进入呼伦贝尔后的城市一站，接下来便向莫尔格勒河的草原曲水出发。',
  },
  莫尔格勒河游客中心: {
    photo: dayPhotos.d2,
    intro:
      '这一站看莫尔格勒河。河道在开阔草原上回转，细密的弯曲把水面与草地连在一起。封面是河流沿线的航拍风景，游客中心是这段行程的导航落点。',
  },
  额尔古纳湿地景区: {
    photo: extraPhotos.ergun,
    intro:
      '从高处看过去，河湾、滩地和林木铺展开来，马蹄岛是这里有辨识度的景观。路书选择的是拉布大林附近的额尔古纳湿地景区，与额尔古纳国家湿地公园是两个不同的景区。',
    sourceUrl: 'https://www.esmengyuan.cn/nd.jsp?id=14',
  },
  根河源国家湿地公园: {
    photo: extraPhotos.genhe,
    intro:
      '森林和湿地在这里相遇：河流、沼泽与林地交错，景色从开阔草原转向大兴安岭的林间水岸。封面为根河地区的秋林风光。',
    sourceUrl: 'https://www.genhe.gov.cn/News/show/574132.html',
  },
  敖鲁古雅使鹿部落: {
    photo: extraPhotos.aoluguya,
    intro:
      '这一站围绕鄂温克族的使鹿文化展开。驯鹿、林间生活与传统居所，让森林不只是沿途风景，也有了人与自然共同生活的故事。',
    sourceUrl: 'https://www.genhe.gov.cn/News/show/1082909.html',
  },
  莫尔道嘎国家森林公园: {
    photo: extraPhotos.mordaga,
    intro:
      '这里以大兴安岭的寒温带森林景观为主，视线从林间延伸到远处山岭。封面记录了九月的林木与红叶，适合把目光从公路移向森林深处。',
    sourceUrl:
      'https://www.nmgsg.com.cn/v2/protectarea/padetail.html?id=7106808598486847488',
  },
  莫尔道嘎镇: {
    photo: dayPhotos.d3,
    intro:
      '这是一段被森林包围的小镇行程。封面里的公路穿过莫尔道嘎秋林，远山与雾气层层展开；路书从这里继续向室韦，景色也逐渐从林海转向草原与界河。',
  },
  室韦小镇: {
    photo: dayPhotos.d4,
    intro:
      '室韦这一站的景色，落在界河方向的草原上。水岸、远处的起伏地形与近处的马群构成开阔视野，从森林走到这里，沿途景色又换了一种尺度。',
  },
  乌兰山游客中心: {
    photo: extraPhotos.wulan,
    intro:
      '沿线来到乌兰山，草原随地形起伏，景区入口附近也能看到开阔的远景。这一站可以先看看沿途视野，再通过下面的实拍帖子了解不同位置的景色。',
  },
  黑山头: {
    photo: dayPhotos.d5,
    intro:
      '黑山头这一站，把视线留给草原和马群。封面拍摄于梁西村，傍晚的光线沿着草地铺开；这里也是路书中从室韦沿线转向返程之前的一段草原风景。',
  },
};
